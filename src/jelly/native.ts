import type { Plugin } from "@opencode/plugin"
import type { Rpc } from "@opencode/plugin/rpc"
import { SERVER_NAME } from "../constants.js"
import { TOOLS } from "../browse-tools.js"
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
  if (task !== undefined) return { state: deps.gate.driving() ? "driving" : "ready", canControl: true, task: strip(task) }
  const ask = deps.gate.oldestAsk()
  // Without an ask there is nothing to allow, so jelly offers no Connect: the person's Chrome is never pre-allowed.
  if (ask === undefined) return { state: "not-connected", canControl: false }
  const connected = await deps.extensionConnected().catch(() => undefined)
  return { state: connected === false ? "extension-needed" : "not-connected", canControl: true, ask: strip(ask) }
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
    // Both actions are the person's, from an owner device: a grant of the `chat` class is not enough.
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

/** The engine tool id of each browse tool: `browse_<tool>`. */
export const GATED_TOOLS: readonly string[] = TOOLS.map((tool) => `${SERVER_NAME}_${tool.name}`)

type Executor = (input: unknown, context: { readonly sessionID: string; readonly agent: string; readonly signal?: AbortSignal }) => Promise<unknown>

/** Wraps one tool's executor: the gate first, then the server. */
export function gated(gate: ChromeGate, id: string, inner: Executor): Executor {
  const tool = id.slice(SERVER_NAME.length + 1)
  return async (input, context) => {
    const admitted = await gate.admit({ sessionID: context.sessionID, agent: String(context.agent), tool, input, ...(context.signal ? { signal: context.signal } : {}) })
    const done = gate.begin(context.sessionID, tool)
    let ok = false
    try {
      const result = await inner(admitted, context)
      ok = !(result !== null && typeof result === "object" && (result as { isError?: unknown }).isError === true)
      return result
    } finally {
      done(ok)
    }
  }
}

/** Puts the gate in front of every browse tool, wherever it is called from. */
export function registerGate(tool: Pick<Plugin.Context["tool"], "transform">, gate: ChromeGate) {
  const wrapped = new WeakSet<object>()
  return tool.transform((editor) => {
    for (const id of GATED_TOOLS) {
      editor.update(id, (info) => {
        const current = info.execute as unknown as Executor
        if (wrapped.has(current)) return
        const next = gated(gate, id, current)
        wrapped.add(next)
        info.execute = next as never
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
