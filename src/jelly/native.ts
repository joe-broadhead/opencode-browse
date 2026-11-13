import type { Plugin } from "@opencode/plugin"
import type { Rpc } from "@opencode/plugin/rpc"
import { SERVER_NAME } from "../constants.js"
import { actionAudience, actionGrantVerifier, ActionGrantRefused, publishedActionKey, type ActionPublicKey } from "./action-grant.js"
import { ChromeGate, type ChromeAsk, type ChromeTask } from "./chrome-gate.js"

/**
 * Browse's side of jelly's personal-browser binding (D103) and the per-task ask (issue #3).
 *
 * Under jelly, in real mode, every browse tool's executor is wrapped so that a call reaches the MCP server only for a
 * session the person allowed (`ChromeGate`). The wrap sits in the one place the model path, Code Mode and the tools
 * RPC all pass through. jelly reads and acts through the plugin's own RPC, whose id is the package name:
 *
 * - `browser.status` (read-only): `{ state, canControl }`, jelly's shape, plus `ask` and `task` when there is one.
 * - `browser.ask` (read-only): the ask Connect would allow, in words, for the confirmation jelly draws.
 * - `browser.inbox` (read-only): the pending ask as an Inbox item.
 * - `act.browser.connect`: Allow for this task, with a verified jelly action grant.
 * - `act.browser.stop`: the person's Stop, with a verified jelly action grant.
 */

export const PACKAGE_NAME = "@joe-broadhead/opencode-browse"
export const NATIVE_VIEW = "browser-native"
export const ACTIONS = { connect: "browser.connect", stop: "browser.stop" } as const

export type BrowserState = "not-connected" | "extension-needed" | "ready" | "driving" | "needs-you" | "unavailable"

export interface BrowserStatus {
  readonly state: BrowserState
  readonly canControl: boolean
  readonly ask?: Omit<ChromeAsk, "sessionID">
  readonly task?: Omit<ChromeTask, "sessionID">
}

const JELLY_SYMBOLS = ["jelly.engine-seal", "jelly.plugin-secrets", "jelly.action-key"].map((name) => Symbol.for(name))

/** True inside a jelly engine: jelly's engine hand-off publishes these before any other plugin runs. */
export function underJelly(holder: Record<symbol, unknown> = globalThis as Record<symbol, unknown>): boolean {
  return JELLY_SYMBOLS.some((symbol) => holder[symbol] !== undefined)
}

const object = { type: "object" } as const
const askSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    agent: { type: "string" },
    task: { type: "string" },
    origins: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    at: { type: "string" },
  },
}
const taskSchema = {
  type: "object",
  properties: {
    agent: { type: "string" },
    task: { type: "string" },
    origins: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    since: { type: "string" },
  },
}
export const STATUS_OUTPUT = {
  type: "object",
  required: ["state", "canControl"],
  properties: {
    state: { enum: ["not-connected", "extension-needed", "ready", "driving", "needs-you", "unavailable"] },
    canControl: { type: "boolean" },
    ask: askSchema,
    task: taskSchema,
  },
}
export const CONNECT_INPUT = {
  type: "object",
  properties: { ask: { type: "string", pattern: "^ask_[a-f0-9]{24}$" } },
  additionalProperties: false,
}
export const STOP_INPUT = {
  type: "object",
  properties: { session: { type: "string", minLength: 1, maxLength: 128 } },
  additionalProperties: false,
}
const actionCall = { type: "object", required: ["input", "grant"], properties: { input: {}, grant: { type: "string" } } }

export const NativeRpc = {
  id: PACKAGE_NAME,
  methods: {
    "browser.status": { input: object, output: STATUS_OUTPUT },
    "browser.ask": { input: object, output: { type: "string" } },
    "browser.inbox": { input: object, output: { type: "object", required: ["items"], properties: { items: { type: "array" } } } },
    "act.browser.connect": { input: actionCall, output: { type: "boolean" } },
    "act.browser.stop": { input: actionCall, output: { type: "boolean" } },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export interface NativeDeps {
  readonly gate: ChromeGate
  /** False in managed mode, with no binary, or with unusable options: the person's Chrome is not this plugin's to use. */
  readonly available: () => boolean
  /** Whether the browse extension is connected, when that is known quickly. */
  readonly extensionConnected: () => Promise<boolean | undefined>
  readonly key?: () => ActionPublicKey | undefined
  readonly now?: () => number
}

const strip = <T extends { sessionID: string }>(value: T): Omit<T, "sessionID"> => {
  const { sessionID: _sessionID, ...rest } = value
  return rest
}

const sites = (origins: readonly string[] | null) => (origins === null ? "any site" : origins.join(", "))

/** jelly's `personal-browser` read. */
export async function browserStatus(deps: NativeDeps): Promise<BrowserStatus> {
  if (!deps.available()) return { state: "unavailable", canControl: false }
  const [task] = deps.gate.tasks().sort((left, right) => right.since.localeCompare(left.since))
  const ask = deps.gate.oldestAsk()
  // A waiting ask comes first, even while another task holds the Chrome: jelly offers Connect only in these two
  // states, and an ask it cannot offer would wait unseen until it timed out. The running task is still reported.
  if (ask !== undefined) {
    const connected = await deps.extensionConnected().catch(() => undefined)
    return { state: connected === false ? "extension-needed" : "not-connected", canControl: true, ask: strip(ask), ...(task ? { task: strip(task) } : {}) }
  }
  if (task !== undefined) return { state: deps.gate.driving() ? "driving" : "ready", canControl: true, task: strip(task) }
  // Without an ask there is nothing to allow, so jelly offers no Connect: the person's Chrome is never pre-allowed.
  return { state: "not-connected", canControl: false }
}

/** The words of the ask Connect would allow, for the confirmation jelly draws. */
export function askText(gate: ChromeGate, input: unknown): string {
  const id = askIdOf(input)
  const ask = id === undefined ? gate.oldestAsk() : gate.asks().find((item) => item.id === id)
  if (ask === undefined) return "No agent is asking to use your Chrome right now."
  return `${ask.agent} wants to use your Chrome for this task: ${ask.task}. Sites: ${sites(ask.origins)}. Allowed for this task only; it ends when the task ends or you stop it.`
}

export function inboxItems(gate: ChromeGate) {
  return {
    items: gate.asks().map((ask) => ({
      key: ask.id,
      category: "request",
      kind: "chrome-ask",
      label: "Wants to use your Chrome",
      name: ask.agent,
      line: `${ask.task} (${sites(ask.origins)})`,
      at: ask.at,
    })),
  }
}

const askIdOf = (input: unknown): string | undefined => {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>).ask : undefined
  return typeof value === "string" ? value : undefined
}

/** The two actions, each checked against jelly's grant before it changes anything. */
export function nativeActions(deps: NativeDeps) {
  const grants = actionGrantVerifier({ audience: actionAudience(PACKAGE_NAME), key: deps.key ?? (() => publishedActionKey()), ...(deps.now ? { now: deps.now } : {}) })
  const checked = (action: string, call: unknown) => {
    const { input, grant } = (call ?? {}) as { input?: unknown; grant?: unknown }
    const claims = grants.verify(action, { input: input ?? null, grant })
    // `cls` is the class the action declares, not proof of the device: jelly's host refuses a `local` action from a
    // paired device. A grant of another class was not minted for these actions, so it is refused.
    if (claims.cls !== "local") throw new ActionGrantRefused("The grant is not from an owner device.")
    return input
  }
  return {
    connect(call: unknown): boolean {
      const input = checked(ACTIONS.connect, call)
      if (!deps.available()) return false
      return deps.gate.allow(askIdOf(input)) !== undefined
    },
    stop(call: unknown): boolean {
      const input = checked(ACTIONS.stop, call)
      const session = input !== null && typeof input === "object" ? (input as Record<string, unknown>).session : undefined
      deps.gate.stop(typeof session === "string" ? session : undefined)
      return true
    },
  }
}

export function registerNativeRpc(rpc: Pick<Plugin.Context["rpc"], "register">, deps: NativeDeps) {
  const actions = nativeActions(deps)
  const refused = (error: unknown, fail: (code: string, message: string, data: Record<string, unknown>) => unknown) =>
    error instanceof ActionGrantRefused ? fail("refused", error.message, {}) : Promise.reject(error)
  return rpc.register(NativeRpc, {
    "browser.status": () => browserStatus(deps),
    "browser.ask": async (input: unknown) => askText(deps.gate, input),
    "browser.inbox": async () => inboxItems(deps.gate),
    "act.browser.connect": async (call: unknown, { error }: { error: (code: string, message: string, data: Record<string, unknown>) => unknown }) => {
      try {
        return actions.connect(call)
      } catch (cause) {
        return refused(cause, error)
      }
    },
    "act.browser.stop": async (call: unknown, { error }: { error: (code: string, message: string, data: Record<string, unknown>) => unknown }) => {
      try {
        return actions.stop(call)
      } catch (cause) {
        return refused(cause, error)
      }
    },
  } as never)
}

type Executor = (input: unknown, context: { readonly sessionID: string; readonly agent: string; readonly signal?: AbortSignal }) => Promise<unknown>

/** A tool of the browse server: its `browse_` id, or the browse namespace. Classified or not, it is gated. */
export function isServerTool(info: { readonly id: string; readonly options?: { readonly namespace?: unknown } | undefined }): boolean {
  return info.id.startsWith(`${SERVER_NAME}_`) || info.options?.namespace === SERVER_NAME
}

/**
 * Wraps one tool's executor: the gate first, then the server, with a signal that also aborts when the grant ends, so
 * the person's Stop ends a call already running. The call fails at once even if the server ignores the abort.
 */
export function gated(gate: ChromeGate, id: string, inner: Executor): Executor {
  const tool = id.startsWith(`${SERVER_NAME}_`) ? id.slice(SERVER_NAME.length + 1) : id
  return async (input, context) => {
    const admitted = await gate.admit({ sessionID: context.sessionID, agent: String(context.agent), tool, input, ...(context.signal ? { signal: context.signal } : {}) })
    const { signal: granted, done } = gate.begin(context.sessionID, tool)
    const signal = context.signal ? AbortSignal.any([context.signal, granted]) : granted
    let onEnd = () => undefined as void
    const ended = new Promise<never>((_, reject) => {
      onEnd = () => reject(granted.reason)
      if (granted.aborted) onEnd()
      else granted.addEventListener("abort", onEnd, { once: true })
    })
    ended.catch(() => undefined)
    let ok = false
    try {
      const result = await Promise.race([inner(admitted, { ...context, signal }), ended])
      ok = !(result !== null && typeof result === "object" && (result as { isError?: unknown }).isError === true)
      return result
    } finally {
      granted.removeEventListener("abort", onEnd)
      done(ok)
    }
  }
}

/** Puts the gate in front of every tool of the browse server, wherever it is called from. */
export function registerGate(tool: Pick<Plugin.Context["tool"], "transform">, gate: ChromeGate) {
  const wrapped = new WeakSet<object>()
  return tool.transform((editor) => {
    for (const info of editor.list()) {
      if (!isServerTool(info)) continue
      editor.update(info.id, (next) => {
        const current = next.execute as unknown as Executor
        if (wrapped.has(current)) return
        const guarded = gated(gate, info.id, current)
        wrapped.add(guarded)
        next.execute = guarded as never
      })
    }
  })
}

/** Ends a session's grant when the session is deleted or archived. */
export function watchSessions(event: Plugin.Context["event"], gate: ChromeGate): () => void {
  const controller = new AbortController()
  void (async () => {
    try {
      for await (const item of event.subscribe({ types: ["session.deleted", "session.archived"], signal: controller.signal })) {
        const data = (item as { data?: { sessionID?: unknown } }).data
        if (typeof data?.sessionID === "string") gate.end(data.sessionID, "session-ended")
      }
    } catch {
      // The stream ends with the engine; the idle limit still ends every grant.
    }
  })()
  return () => controller.abort()
}
