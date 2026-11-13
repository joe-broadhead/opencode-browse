import { randomBytes } from "node:crypto"
import { browseError } from "../constants.js"

/**
 * The person's Chrome, per task (issue #3): an agent may use the person's own Chrome for one task when the person
 * allows it, never by default and never for good.
 *
 * A **task** is one OpenCode session (the conversation) and the agent that runs it. The grant lives in this object's
 * memory only: no rule, saved approval or file holds it, so nothing survives the engine stopping. It ends at the first
 * of: the agent's `session_reset` or `session_delete` in that session, the person's Stop, the session being deleted
 * or archived, an hour with no browse call, or `dispose`. Another session never uses it; its first call asks afresh.
 *
 * `admit` runs before any browse tool reaches the MCP server. With no grant it records an ask and waits for the
 * person's answer (Allow for this task, through `allow`), the call's abort, or the ask's time limit; nothing reaches
 * the relay, the extension or the browser meanwhile.
 */

export interface ChromeAsk {
  readonly id: string
  readonly sessionID: string
  readonly agent: string
  readonly task: string
  /** The sites the agent named for the task, or null for any site. */
  readonly origins: readonly string[] | null
  readonly at: string
}

export interface ChromeTask {
  readonly sessionID: string
  readonly agent: string
  readonly task: string
  readonly origins: readonly string[] | null
  readonly since: string
}

export type ChromeEnd = "task-done" | "stopped" | "session-ended" | "idle" | "disposed"

interface PendingAsk extends ChromeAsk {
  readonly waiters: Set<{ resolve: () => void; reject: (error: Error) => void }>
  timer: ReturnType<typeof setTimeout> | undefined
}

interface Grant extends ChromeTask {
  lastUsed: number
  inFlight: number
}

export interface ChromeCall {
  readonly sessionID: string
  readonly agent: string
  /** The browse tool's own name, without the `browse_` prefix. */
  readonly tool: string
  readonly input: unknown
  readonly signal?: AbortSignal
}

export interface ChromeGateOptions {
  /** The task's words for the ask: the session's title. */
  readonly describe: (sessionID: string) => Promise<string>
  readonly now?: () => number
  /** How long an ask waits for the person before it is withdrawn. */
  readonly askTimeoutMs?: number
  /** How long a grant lasts with no browse call. */
  readonly idleMs?: number
  /** Told whenever an ask or a grant starts or ends. */
  readonly changed?: () => void
}

export const ASK_TIMEOUT_MS = 5 * 60_000
export const IDLE_MS = 60 * 60_000
const ENDING_TOOLS = new Set(["session_reset", "session_delete"])
const SCOPING_TOOLS = new Set(["session_new", "session_allowlist"])

const notAllowed = (why: string) =>
  browseError(
    "CHROME_NOT_ALLOWED",
    `The person has not allowed their Chrome for this task (${why}).`,
    "Tell the person what you need their Chrome for and which sites, then try again: they will be asked to allow it for this task.",
  )

/** The `allowedOrigins` a call names, when it names some. */
export function originsOf(tool: string, input: unknown): readonly string[] | null {
  if (!SCOPING_TOOLS.has(tool) || input === null || typeof input !== "object") return null
  const value = (input as Record<string, unknown>).allowedOrigins
  if (!Array.isArray(value)) return null
  const origins = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim())
  return origins.length === 0 ? null : [...new Set(origins)].slice(0, 32)
}

export class ChromeGate {
  readonly #asks = new Map<string, PendingAsk>()
  readonly #grants = new Map<string, Grant>()
  readonly #options: ChromeGateOptions
  readonly #now: () => number
  #ended = false

  constructor(options: ChromeGateOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
  }

  /**
   * Lets one browse call through, or waits for the person, or refuses. Returns the input the call runs with: a
   * `session_new` under a grant with sites gets those sites when it names none.
   */
  async admit(call: ChromeCall): Promise<unknown> {
    if (this.#ended) throw notAllowed("the plugin has stopped")
    if (call.signal?.aborted) throw notAllowed("the call was cancelled")
    this.#expire()
    let grant = this.#grants.get(call.sessionID)
    if (grant === undefined || grant.agent !== call.agent) {
      await this.#ask(call)
      grant = this.#grants.get(call.sessionID)
      if (grant === undefined || grant.agent !== call.agent) throw notAllowed("the answer was not Allow for this task")
    }
    return this.#scoped(grant, call)
  }

  /** Marks a call that reached the server, for `driving`; the returned function marks its end. */
  begin(sessionID: string, tool: string): (ok: boolean) => void {
    const grant = this.#grants.get(sessionID)
    if (grant === undefined) return () => undefined
    grant.inFlight++
    grant.lastUsed = this.#now()
    this.#changed()
    return (ok) => {
      grant.inFlight = Math.max(0, grant.inFlight - 1)
      grant.lastUsed = this.#now()
      // The agent's own end of the task: it reset or deleted its browse session.
      if (ok && ENDING_TOOLS.has(tool)) this.end(sessionID, "task-done")
      else this.#changed()
    }
  }

  /** Allow for this task: the ask named, or the oldest one. Returns the task it allowed, or undefined. */
  allow(askID?: string): ChromeTask | undefined {
    this.#expire()
    const oldest = askID === undefined ? this.oldestAsk() : undefined
    const ask = this.#asks.get(askID ?? oldest?.id ?? "")
    if (ask === undefined) return undefined
    this.#forget(ask)
    const task: Grant = { sessionID: ask.sessionID, agent: ask.agent, task: ask.task, origins: ask.origins, since: new Date(this.#now()).toISOString(), lastUsed: this.#now(), inFlight: 0 }
    this.#grants.set(ask.sessionID, task)
    for (const waiter of ask.waiters) waiter.resolve()
    this.#changed()
    return this.#public(task)
  }

  /** Not now, or a withdrawn ask: its waiting calls are refused. */
  decline(askID: string, why = "the person said not now"): boolean {
    const ask = this.#asks.get(askID)
    if (ask === undefined) return false
    this.#forget(ask)
    for (const waiter of ask.waiters) waiter.reject(notAllowed(why))
    this.#changed()
    return true
  }

  /** Ends one session's grant and ask, or with no session every one: the person's Stop. Returns how many ended. */
  stop(sessionID?: string): number {
    let count = 0
    for (const ask of [...this.#asks.values()]) {
      if (sessionID !== undefined && ask.sessionID !== sessionID) continue
      if (this.decline(ask.id, "the person stopped it")) count++
    }
    for (const id of [...this.#grants.keys()]) {
      if (sessionID !== undefined && id !== sessionID) continue
      if (this.end(id, "stopped")) count++
    }
    return count
  }

  /** Ends one session's grant. */
  end(sessionID: string, _why: ChromeEnd): boolean {
    const had = this.#grants.delete(sessionID)
    if (had) this.#changed()
    return had
  }

  /** Every grant and ask ends, and no call is let through again. */
  dispose(): void {
    this.stop()
    this.#ended = true
  }

  oldestAsk(): ChromeAsk | undefined {
    this.#expire()
    const [first] = [...this.#asks.values()].sort((left, right) => left.at.localeCompare(right.at))
    return first === undefined ? undefined : this.#publicAsk(first)
  }

  asks(): ChromeAsk[] {
    this.#expire()
    return [...this.#asks.values()].map((ask) => this.#publicAsk(ask))
  }

  tasks(): ChromeTask[] {
    this.#expire()
    return [...this.#grants.values()].map((grant) => this.#public(grant))
  }

  driving(): boolean {
    return [...this.#grants.values()].some((grant) => grant.inFlight > 0)
  }

  async #ask(call: ChromeCall): Promise<void> {
    const existing = [...this.#asks.values()].find((ask) => ask.sessionID === call.sessionID && ask.agent === call.agent)
    const ask = existing ?? (await this.#open(call))
    if (this.#grants.get(call.sessionID)?.agent === call.agent) return
    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve: () => done(resolve), reject: (error: Error) => done(() => reject(error)) }
      const onAbort = () => {
        ask.waiters.delete(waiter)
        // The person stopped the turn: with nobody waiting the ask is withdrawn.
        if (ask.waiters.size === 0) this.decline(ask.id, "the call was cancelled")
        reject(notAllowed("the call was cancelled"))
      }
      const done = (settle: () => void) => {
        call.signal?.removeEventListener("abort", onAbort)
        settle()
      }
      ask.waiters.add(waiter)
      call.signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  async #open(call: ChromeCall): Promise<PendingAsk> {
    const task = await this.#options.describe(call.sessionID).catch(() => "")
    // A second call of the same session may have opened one while the title was read.
    const raced = [...this.#asks.values()].find((ask) => ask.sessionID === call.sessionID && ask.agent === call.agent)
    if (raced !== undefined) return raced
    const ask: PendingAsk = {
      id: `ask_${randomBytes(12).toString("hex")}`,
      sessionID: call.sessionID,
      agent: call.agent,
      task: oneLine(task, 200) || "This conversation",
      origins: originsOf(call.tool, call.input),
      at: new Date(this.#now()).toISOString(),
      waiters: new Set(),
      timer: undefined,
    }
    const timeout = this.#options.askTimeoutMs ?? ASK_TIMEOUT_MS
    ask.timer = setTimeout(() => this.decline(ask.id, "nobody answered in time"), timeout)
    ask.timer.unref?.()
    this.#asks.set(ask.id, ask)
    this.#changed()
    return ask
  }

  #scoped(grant: Grant, call: ChromeCall): unknown {
    if (grant.origins === null || !SCOPING_TOOLS.has(call.tool)) return call.input
    const named = originsOf(call.tool, call.input)
    if (named === null) {
      if (call.tool !== "session_new") {
        throw browseError("CHROME_SCOPE", "Removing the site allowlist would leave the sites the person allowed for this task.", "Keep to the allowed sites, or tell the person which other sites you need and start a new task.")
      }
      return { ...(call.input as Record<string, unknown> | null ?? {}), allowedOrigins: [...grant.origins] }
    }
    const outside = named.filter((origin) => !grant.origins!.includes(origin))
    if (outside.length > 0) {
      throw browseError("CHROME_SCOPE", `The person allowed their Chrome for ${grant.origins.join(", ")} only, not ${outside.join(", ")}.`, "Keep to the allowed sites, or tell the person which other sites you need and start a new task.")
    }
    return call.input
  }

  #expire() {
    const idle = this.#options.idleMs ?? IDLE_MS
    for (const [id, grant] of this.#grants) if (grant.inFlight === 0 && this.#now() - grant.lastUsed >= idle) this.end(id, "idle")
  }

  #forget(ask: PendingAsk) {
    if (ask.timer !== undefined) clearTimeout(ask.timer)
    this.#asks.delete(ask.id)
  }

  #changed() {
    try {
      this.#options.changed?.()
    } catch {
      // A listener's failure never changes a grant.
    }
  }

  #public(grant: Grant): ChromeTask {
    return { sessionID: grant.sessionID, agent: grant.agent, task: grant.task, origins: grant.origins, since: grant.since }
  }

  #publicAsk(ask: PendingAsk): ChromeAsk {
    return { id: ask.id, sessionID: ask.sessionID, agent: ask.agent, task: ask.task, origins: ask.origins, at: ask.at }
  }
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim()
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}
