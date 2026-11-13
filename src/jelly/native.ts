import type { Plugin } from "@opencode/plugin"
import type { Rpc } from "@opencode/plugin/rpc"
import { randomBytes } from "node:crypto"
import { errorText, SERVER_NAME } from "../constants.js"
import { actionAudience, actionGrantVerifier, ActionGrantRefused, publishedActionKey, type ActionPublicKey } from "./action-grant.js"
import { ChromeGate, type ChromeAsk, type ChromeMode } from "./chrome-gate.js"

/**
 * Browse's side of jelly's personal-browser binding (D103) and the per-task ask (issue #3).
 *
 * Under jelly, in real mode, every browse tool's executor is wrapped so that a call reaches the MCP server only for a
 * session the person allowed (`ChromeGate`). The wrap sits in the one place the model path, Code Mode and the tools
 * RPC all pass through. jelly reads and acts through the plugin's own RPC, whose id is the package name:
 *
 * - `browser.status` (read-only): jelly's shape (opencode-browse#5, B2 and B3):
 *   `{ state, canControl, task?: { id, title, startedAt }, agent?, request? }`.
 * - `browser.ask` (read-only): the ask Connect or Allow would allow, in words, for the confirmation jelly draws.
 * - `browser.inbox` (read-only): the pending asks as Inbox items.
 * - `act.browser.connect`: Allow for this task (the oldest ask, or `{ ask }`), with a verified jelly action grant.
 * - `act.browser.allow` / `act.browser.decline`: Allow for this task / Not now for one request `{ id }` (B3).
 * - `act.browser.stop`: the person's Stop, with a verified jelly action grant.
 *
 * A new ask is also filed as jelly's `chrome-ask` notice (`jelly.core` request, kind `notice`), which reaches the
 * person whatever the agent's access level. Each change of the read can be signalled by the content-free
 * `personal-browser` notice (B4), so jelly reads again at once.
 */

export const PACKAGE_NAME = "@joe-broadhead/opencode-browse"
export const NATIVE_VIEW = "browser-native"
/** The two actions jelly's `personal-browser` hint names (its `actions` object is strict: connect and stop only). */
export const ACTIONS = { connect: "browser.connect", stop: "browser.stop" } as const
/** B3's per-request answers, declared as ordinary actions until jelly's hint grows them. */
export const REQUEST_ACTIONS = { allow: "browser.allow", decline: "browser.decline" } as const
export const ASK_NOTICE = "chrome-ask"
/** B4: the content-free notice that tells jelly the read changed. */
export const CHANGE_NOTICE = "personal-browser"

export type BrowserState = "not-connected" | "extension-needed" | "ready" | "driving" | "needs-you" | "unavailable" | "asking"

/**
 * The state of a request with no task holding the Chrome. B3 says `asking`, but jelly at 99cd657c4 knows six states
 * (`frontend/core/src/words/plugin-data.ts`): an unknown one reads as "not available" and offers neither Connect nor
 * Stop (`personal-browser.ts`), which would hide the only way to allow. Until jelly draws `asking`, a request reads
 * `not-connected` with `request`, and jelly's Connect allows it. Change this one constant when jelly ships `asking`.
 */
export const ASKING_STATE: "asking" | "not-connected" = "not-connected"

/**
 * B4 says to raise `personal-browser` on every change, with no content, in a `browser` category. jelly at 99cd657c4
 * has no `browser` category and requires a label and a preview, so the notice is declared as a `request` with the
 * `count` preview (no name, no line); raised in that category each change would be a banner (one per browse call, as
 * `driving` comes and goes). It is raised only once this is true, when jelly treats it as a signal to read.
 */
export const RAISE_CHANGE_NOTICES = false

export interface BrowserRequest {
  readonly id: string
  readonly agent: string
  readonly task: { readonly title: string }
  /** `sites` is the sites the agent named; `["*"]` is any site. */
  readonly scope: { readonly sites: readonly string[]; readonly mode: ChromeMode }
  readonly expiresAt: string
}

export interface BrowserStatus {
  readonly state: BrowserState
  readonly canControl: boolean
  /** While `driving` or `needs-you`: the task holding the Chrome. */
  readonly task?: { readonly id: string; readonly title: string; readonly startedAt: string }
  /** The agent that holds the session. */
  readonly agent?: string
  /** An agent's waiting request to use the person's Chrome (B3). */
  readonly request?: BrowserRequest
}

const JELLY_SYMBOLS = ["jelly.engine-seal", "jelly.plugin-secrets", "jelly.action-key"].map((name) => Symbol.for(name))

/** True inside a jelly engine: jelly's engine hand-off publishes these before any other plugin runs. */
export function underJelly(holder: Record<symbol, unknown> = globalThis as Record<symbol, unknown>): boolean {
  return JELLY_SYMBOLS.some((symbol) => holder[symbol] !== undefined)
}

const object = { type: "object" } as const
const requestSchema = {
  type: "object",
  required: ["id", "agent", "task", "scope", "expiresAt"],
  properties: {
    id: { type: "string" },
    agent: { type: "string" },
    task: { type: "object", required: ["title"], properties: { title: { type: "string" } } },
    scope: {
      type: "object",
      required: ["sites", "mode"],
      properties: { sites: { type: "array", items: { type: "string" } }, mode: { enum: ["read", "act"] } },
    },
    expiresAt: { type: "string" },
  },
}
const taskSchema = {
  type: "object",
  required: ["id", "title", "startedAt"],
  properties: { id: { type: "string" }, title: { type: "string" }, startedAt: { type: "string" } },
}
export const STATUS_OUTPUT = {
  type: "object",
  required: ["state", "canControl"],
  properties: {
    state: { enum: ["not-connected", "extension-needed", "ready", "driving", "needs-you", "unavailable", "asking"] },
    canControl: { type: "boolean" },
    task: taskSchema,
    agent: { type: "string" },
    request: requestSchema,
  },
}
export const REQUEST_INPUT = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 64 } },
  additionalProperties: false,
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
    "act.browser.allow": { input: actionCall, output: { type: "boolean" } },
    "act.browser.decline": { input: actionCall, output: { type: "boolean" } },
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
  /** The state of a request with no task holding the Chrome; `ASKING_STATE` unless a test says otherwise. */
  readonly askingState?: "asking" | "not-connected"
}

const sites = (origins: readonly string[] | null) => (origins === null ? "any site" : origins.join(", "))
const modeWords = (mode: ChromeMode) => (mode === "read" ? "to read only" : "to read and act")

export function requestOf(ask: ChromeAsk): BrowserRequest {
  return { id: ask.id, agent: ask.agent, task: { title: ask.task }, scope: { sites: ask.origins === null ? ["*"] : [...ask.origins], mode: ask.mode }, expiresAt: ask.expiresAt }
}

/** jelly's `personal-browser` read (B2, B3). Read-only: it never starts, stops or changes anything. */
export async function browserStatus(deps: NativeDeps): Promise<BrowserStatus> {
  if (!deps.available()) return { state: "unavailable", canControl: false }
  const [task] = deps.gate.tasks().sort((left, right) => right.since.localeCompare(left.since))
  const ask = deps.gate.oldestAsk()
  const request = ask === undefined ? {} : { request: requestOf(ask) }
  // While a task holds the Chrome, Stop must stay reachable: jelly offers Stop only in `ready`, `driving` and
  // `needs-you`, so the state stays one of those and a new request rides along as `request`. It also reaches the
  // person through the `chrome-ask` notice, the Inbox and the plugin's page, and ends as Not now when it runs out.
  if (task !== undefined) {
    const driving = deps.gate.driving()
    return {
      state: driving ? "driving" : "ready",
      canControl: true,
      ...(driving ? { task: { id: task.id, title: task.task, startedAt: task.since } } : {}),
      agent: task.agent,
      ...request,
    }
  }
  // No task: a waiting request is `asking` (or, until jelly draws it, `not-connected`, which jelly's Connect allows).
  if (ask !== undefined) {
    const asking = deps.askingState ?? ASKING_STATE
    if (asking === "asking") return { state: "asking", canControl: true, ...request }
    const connected = await deps.extensionConnected().catch(() => undefined)
    return { state: connected === false ? "extension-needed" : "not-connected", canControl: true, ...request }
  }
  // Nothing held and nothing asked: ready, never `driving` on a stale allow. There is nothing to allow or stop, so no
  // Connect is offered and the person's Chrome is never pre-allowed.
  return { state: "ready", canControl: false }
}

/** The words of the ask Connect or Allow would allow, for the confirmation jelly draws. */
export function askText(gate: ChromeGate, input: unknown): string {
  const id = askIdOf(input)
  const ask = id === undefined ? gate.oldestAsk() : gate.asks().find((item) => item.id === id)
  if (ask === undefined) return "No agent is asking to use your Chrome right now."
  return `${ask.agent} wants to use your Chrome for this task, ${modeWords(ask.mode)}: ${ask.task}. Sites: ${sites(ask.origins)}. Allowed for this task only; it ends when the task ends or you stop it.`
}

export function inboxItems(gate: ChromeGate) {
  return {
    items: gate.asks().map((ask) => ({
      key: ask.id,
      category: "request",
      kind: "chrome-ask",
      label: "Wants to use your Chrome",
      name: ask.agent,
      line: askLine(ask),
      at: ask.at,
    })),
  }
}

const askLine = (ask: ChromeAsk) => `${ask.task} (${sites(ask.origins)}; ${modeWords(ask.mode)})`

const askIdOf = (input: unknown): string | undefined => {
  if (input === null || typeof input !== "object") return undefined
  const value = (input as Record<string, unknown>).ask ?? (input as Record<string, unknown>).id
  return typeof value === "string" ? value : undefined
}

/** B3's errors for a request id, as the person reads them. */
export class RequestRefused extends Error {
  readonly code: "REQUEST_EXPIRED" | "NOT_YOUR_REQUEST"
  constructor(code: "REQUEST_EXPIRED" | "NOT_YOUR_REQUEST", message: string) {
    super(message)
    this.code = code
  }
}
/** B3's words, exactly: `REQUEST_EXPIRED: this request ran out. Next step: ask the agent to try again.` */
export const REQUEST_EXPIRED = errorText("REQUEST_EXPIRED", "this request ran out.", "ask the agent to try again.")
export const NOT_YOUR_REQUEST = errorText("NOT_YOUR_REQUEST", "this request is not one of your conversations here.", "answer it from the conversation that asked.")

function waitingRequest(gate: ChromeGate, input: unknown): string {
  const id = askIdOf(input) ?? ""
  const fate = gate.fate(id)
  if (fate === "ended") throw new RequestRefused("REQUEST_EXPIRED", REQUEST_EXPIRED)
  if (fate === "unknown") throw new RequestRefused("NOT_YOUR_REQUEST", NOT_YOUR_REQUEST)
  return id
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
    /** Allow for this task, for one request: B3's `allow { id }`. */
    allow(call: unknown): boolean {
      const input = checked(REQUEST_ACTIONS.allow, call)
      const id = waitingRequest(deps.gate, input)
      if (!deps.available()) return false
      return deps.gate.allow(id) !== undefined
    },
    /** Not now, for one request: B3's `decline { id }`. */
    decline(call: unknown): boolean {
      const input = checked(REQUEST_ACTIONS.decline, call)
      return deps.gate.decline(waitingRequest(deps.gate, input))
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
  type Fail = (code: string, message: string, data: Record<string, unknown>) => unknown
  const refused = (error: unknown, fail: Fail) =>
    error instanceof ActionGrantRefused ? fail("refused", error.message, {}) : error instanceof RequestRefused ? fail(error.code, error.message, {}) : Promise.reject(error)
  const answer = (run: (call: unknown) => boolean) => async (call: unknown, { error }: { error: Fail }) => {
    try {
      return run(call)
    } catch (cause) {
      return refused(cause, error)
    }
  }
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
    "act.browser.allow": answer(actions.allow),
    "act.browser.decline": answer(actions.decline),
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

/** jelly's core plugin RPC, through which a plugin files a notice for the person. */
const JELLY_CORE = {
  id: "jelly.core",
  methods: { request: { input: { type: "object" }, output: { type: "object" } } },
  events: {},
} as const

type CoreRequest = (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>

/**
 * Files the ask as jelly's `chrome-ask` notice: jelly raises it to the agent's people whatever the agent's access
 * level, and keeps it for the Inbox. Never waited on: outside jelly, or refused, nothing changes. Filed with `keep`,
 * so a host that is away when it is filed still raises it once it reads the pending requests.
 */
export function noticeAsk(rpc: Plugin.Context["rpc"] | { readonly request: CoreRequest }, ask: ChromeAsk): void {
  fileNotice(rpc, { package: PACKAGE_NAME, notice: ASK_NOTICE, key: ask.id, name: ask.agent, line: askLine(ask) }, true)
}

/**
 * B4: tells jelly the `personal-browser` read changed, with no content (no name, no line), keyed by the change so
 * each one is delivered. Raised only when the read's answer differs from the last one raised.
 */
export function changeNotices(rpc: Plugin.Context["rpc"] | { readonly request: CoreRequest }, read: () => Promise<BrowserStatus>): () => void {
  let last = ""
  let queued = false
  return () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      void read()
        .then((status) => {
          const now = JSON.stringify(status)
          if (now === last) return
          last = now
          // Not kept: a change signal a host missed is stale, and the next read answers anyway.
          fileNotice(rpc, { package: PACKAGE_NAME, notice: CHANGE_NOTICE, key: `chg_${randomBytes(12).toString("hex")}` }, false)
        })
        .catch(() => undefined)
    })
  }
}

function fileNotice(rpc: Plugin.Context["rpc"] | { readonly request: CoreRequest }, body: Record<string, unknown>, keep: boolean): void {
  let request: CoreRequest
  try {
    request = "request" in rpc ? rpc.request : (rpc(JELLY_CORE as never) as unknown as { request: CoreRequest }).request
  } catch {
    return
  }
  void Promise.resolve()
    .then(() =>
      request(
        {
          id: `browse-${randomBytes(12).toString("hex")}`,
          kind: "notice",
          body,
          // The ask is kept: if jelly's host is away past the wait, the request stays filed and the host still raises
          // it when it reads what is pending (`jelly.core` request, `keep`).
          keep,
        },
        { signal: AbortSignal.timeout(10_000) },
      ),
    )
    .catch(() => undefined)
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
