import { randomBytes } from "node:crypto"
import { TOOLS } from "../browse-tools.js"
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
 *
 * **Mode.** Every ask and grant is `read` or `act`, and the gate enforces it. The call that asks says which: a tool of
 * the `read` class in the plugin's own table (`READ_TOOLS`) asks to read, any other tool, and any tool the table does
 * not classify, asks to act. Under a `read` grant only `READ_TOOLS` pass; an act call there asks again, for `act`, and
 * waits, so the person sees the wider mode before anything changes.
 */

export type ChromeMode = "read" | "act"

/** The tools a `read` grant lets through: the `read` class of the plugin's own table. Anything else is act. */
export const READ_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((tool) => tool.class === "read").map((tool) => tool.name))

/** The mode one browse tool needs. An unclassified tool needs `act`. */
export function modeOf(tool: string): ChromeMode {
  return READ_TOOLS.has(tool) ? "read" : "act"
}

const covers = (granted: ChromeMode, needed: ChromeMode) => granted === "act" || needed === "read"

export interface ChromeAsk {
  readonly id: string
  readonly sessionID: string
  readonly agent: string
  readonly task: string
  /** The sites the agent named for the task, or null for any site. */
  readonly origins: readonly string[] | null
  readonly mode: ChromeMode
  readonly at: string
  /** When the ask ends unanswered, as Not now. */
  readonly expiresAt: string
}

export interface ChromeTask {
  /** The grant's own id, never the session's. */
  readonly id: string
  readonly sessionID: string
  readonly agent: string
  readonly task: string
  readonly origins: readonly string[] | null
  readonly mode: ChromeMode
  readonly since: string
}

/** What became of a request id: still waiting, answered or run out, or never one of this engine's. */
export type RequestFate = "waiting" | "ended" | "unknown"

export type ChromeEnd = "task-done" | "stopped" | "session-ended" | "idle" | "disposed"

interface PendingAsk extends ChromeAsk {
  readonly waiters: Set<{ resolve: () => void; reject: (error: Error) => void }>
  timer: ReturnType<typeof setTimeout> | undefined
}

interface Grant extends Omit<ChromeTask, "mode"> {
  mode: ChromeMode
  lastUsed: number
  inFlight: number
  /** Aborted when the grant ends, so a call already running stops with it. */
  readonly controller: AbortController
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
  /** Told once when an ask opens, to reach the person (jelly's notice). */
  readonly asked?: (ask: ChromeAsk) => void
}

const ENDED: Readonly<Record<ChromeEnd, string>> = {
  "task-done": "the task ended",
  stopped: "the person stopped it",
  "session-ended": "the conversation ended",
  idle: "the task was idle for an hour",
  disposed: "the plugin has stopped",
}

export const ASK_TIMEOUT_MS = 5 * 60_000
export const IDLE_MS = 60 * 60_000
/** How many ended request ids are remembered, to tell `REQUEST_EXPIRED` from `NOT_YOUR_REQUEST`. */
const ENDED_REMEMBERED = 1024
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
  readonly #endedAsks = new Set<string>()
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
    const needed = modeOf(call.tool)
    let grant = this.#grants.get(call.sessionID)
    if (grant === undefined || grant.agent !== call.agent || !covers(grant.mode, needed)) {
      await this.#ask(call, needed)
      grant = this.#grants.get(call.sessionID)
      if (grant === undefined || grant.agent !== call.agent) throw notAllowed("the answer was not Allow for this task")
      if (!covers(grant.mode, needed)) throw notAllowed("the person allowed reading only, and this call would act")
    }
    return this.#scoped(grant, call)
  }

  /**
   * Marks a call that reached the server, for `driving`. `signal` aborts when the grant ends (Stop, the task's end,
   * the idle limit), so the call stops with it; `done` marks the call's end.
   */
  begin(sessionID: string, tool: string): { readonly signal: AbortSignal; readonly done: (ok: boolean) => void } {
    const grant = this.#grants.get(sessionID)
    if (grant === undefined) return { signal: AbortSignal.abort(notAllowed("the task ended")), done: () => undefined }
    grant.inFlight++
    grant.lastUsed = this.#now()
    this.#changed()
    const done = (ok: boolean) => {
      grant.inFlight = Math.max(0, grant.inFlight - 1)
      grant.lastUsed = this.#now()
      // The agent's own end of the task: it reset or deleted its browse session.
      if (ok && ENDING_TOOLS.has(tool)) this.end(sessionID, "task-done")
      else this.#changed()
    }
    return { signal: grant.controller.signal, done }
  }

  /** Allow for this task: the ask named, or the oldest one. Returns the task it allowed, or undefined. */
  allow(askID?: string): ChromeTask | undefined {
    this.#expire()
    const oldest = askID === undefined ? this.oldestAsk() : undefined
    const ask = this.#asks.get(askID ?? oldest?.id ?? "")
    if (ask === undefined) return undefined
    this.#forget(ask)
    const held = this.#grants.get(ask.sessionID)
    let task: Grant
    if (held !== undefined && held.agent === ask.agent) {
      // A wider ask of the same task: the grant is the same one, now to act; a narrower one changes nothing.
      held.mode = covers(held.mode, ask.mode) ? held.mode : ask.mode
      held.lastUsed = this.#now()
      task = held
    } else {
      if (held !== undefined) this.end(ask.sessionID, "task-done")
      task = { id: `task_${randomBytes(12).toString("hex")}`, sessionID: ask.sessionID, agent: ask.agent, task: ask.task, origins: ask.origins, mode: ask.mode, since: new Date(this.#now()).toISOString(), lastUsed: this.#now(), inFlight: 0, controller: new AbortController() }
      this.#grants.set(ask.sessionID, task)
    }
    for (const waiter of ask.waiters) waiter.resolve()
    this.#changed()
    return this.#public(task)
  }

  /** Whether a request id is waiting, has ended (answered, withdrawn or run out), or was never this engine's. */
  fate(askID: string): RequestFate {
    this.#expire()
    if (this.#asks.has(askID)) return "waiting"
    return this.#endedAsks.has(askID) ? "ended" : "unknown"
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
  end(sessionID: string, why: ChromeEnd): boolean {
    const grant = this.#grants.get(sessionID)
    if (grant === undefined) return false
    this.#grants.delete(sessionID)
    grant.controller.abort(notAllowed(ENDED[why]))
    this.#changed()
    return true
  }

  /** Every grant and ask ends, and no call is let through again. */
  dispose(): void {
    for (const ask of [...this.#asks.values()]) this.decline(ask.id, "the plugin has stopped")
    for (const id of [...this.#grants.keys()]) this.end(id, "disposed")
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

  #waitingAsk(call: ChromeCall, needed: ChromeMode): PendingAsk | undefined {
    return [...this.#asks.values()].find((ask) => ask.sessionID === call.sessionID && ask.agent === call.agent && covers(ask.mode, needed))
  }

  async #ask(call: ChromeCall, needed: ChromeMode): Promise<void> {
    const ask = this.#waitingAsk(call, needed) ?? (await this.#open(call, needed))
    const held = this.#grants.get(call.sessionID)
    if (held?.agent === call.agent && covers(held.mode, needed)) return
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

  async #open(call: ChromeCall, mode: ChromeMode): Promise<PendingAsk> {
    const task = await this.#options.describe(call.sessionID).catch(() => "")
    // A second call of the same session may have opened one while the title was read.
    const raced = this.#waitingAsk(call, mode)
    if (raced !== undefined) return raced
    const timeout = this.#options.askTimeoutMs ?? ASK_TIMEOUT_MS
    const held = this.#grants.get(call.sessionID)
    const ask: PendingAsk = {
      id: `ask_${randomBytes(12).toString("hex")}`,
      sessionID: call.sessionID,
      agent: call.agent,
      task: oneLine(task, 200) || "This conversation",
      // A wider ask of a task already allowed keeps the task's sites.
      origins: held?.agent === call.agent ? held.origins : originsOf(call.tool, call.input),
      mode,
      at: new Date(this.#now()).toISOString(),
      expiresAt: new Date(this.#now() + timeout).toISOString(),
      waiters: new Set(),
      timer: undefined,
    }
    ask.timer = setTimeout(() => this.decline(ask.id, "nobody answered in time"), timeout)
    ask.timer.unref?.()
    this.#asks.set(ask.id, ask)
    this.#changed()
    try {
      this.#options.asked?.(this.#publicAsk(ask))
    } catch {
      // Reaching the person is best effort: the ask still waits in the read and the Inbox.
    }
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
    this.#endedAsks.add(ask.id)
    if (this.#endedAsks.size > ENDED_REMEMBERED) this.#endedAsks.delete(this.#endedAsks.values().next().value!)
  }

  #changed() {
    try {
      this.#options.changed?.()
    } catch {
      // A listener's failure never changes a grant.
    }
  }

  #public(grant: Grant): ChromeTask {
    return { id: grant.id, sessionID: grant.sessionID, agent: grant.agent, task: grant.task, origins: grant.origins, mode: grant.mode, since: grant.since }
  }

  #publicAsk(ask: PendingAsk): ChromeAsk {
    return { id: ask.id, sessionID: ask.sessionID, agent: ask.agent, task: ask.task, origins: ask.origins, mode: ask.mode, at: ask.at, expiresAt: ask.expiresAt }
  }
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim()
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}
