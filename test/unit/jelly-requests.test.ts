// jelly's asks of Browse (opencode-browse#5): the read in jelly's shape (B2), the per-task request with its mode, its
// answers and its errors (B3), and the change notice (B4). Each test fails when its rule is reverted.
import { describe, expect, test } from "bun:test"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { TOOLS } from "../../src/browse-tools.js"
import { actionInputDigest, type ActionPublicKey } from "../../src/jelly/action-grant.js"
import { ChromeGate, modeOf, READ_TOOLS } from "../../src/jelly/chrome-gate.js"
import {
  ASK_NOTICE,
  ASKING_STATE,
  askText,
  browserStatus,
  CHANGE_NOTICE,
  changeNotices,
  extensionFact,
  gated,
  inboxItems,
  nativeActions,
  NOT_YOUR_REQUEST,
  noticeAsk,
  PACKAGE_NAME,
  RAISE_CHANGE_NOTICES,
  registerNativeRpc,
  REQUEST_EXPIRED,
  type NativeDeps,
} from "../../src/jelly/native.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const KEY: ActionPublicKey = { kid: createHash("sha256").update("requests-key").digest("base64url"), jwk: publicKey.export({ format: "jwk" }) as ActionPublicKey["jwk"] }

function grant(action: string, input: unknown) {
  const now = Math.floor(Date.now() / 1000)
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const head = part({ alg: "EdDSA", typ: "jelly-act+jwt", kid: KEY.kid })
  const body = part({ iss: "hst_test", aud: `${PACKAGE_NAME}#engine`, act: action, in: actionInputDigest(input), dev: "dev_test", mbr: "acc_test", cls: "local", iat: now, exp: now + 60, jti: randomBytes(16).toString("base64url") })
  return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`
}
const call = (action: string, input: unknown) => ({ input, grant: grant(action, input) })

function setup(options: { askTimeoutMs?: number; askingState?: "asking" | "not-connected"; changed?: () => void; extension?: boolean } = {}) {
  const gate = new ChromeGate({ describe: async () => "Compare train fares", ...(options.askTimeoutMs ? { askTimeoutMs: options.askTimeoutMs } : {}), ...(options.changed ? { changed: options.changed } : {}) })
  const reached: string[] = []
  let release: () => void = () => undefined
  const tool = (name: string, hold = false) =>
    gated(gate, `browse_${name}`, async () => {
      reached.push(name)
      if (hold) await new Promise<void>((resolve) => (release = resolve))
      return { content: [] }
    })
  const deps: NativeDeps = { gate, available: () => true, extensionConnected: async () => ("extension" in options ? options.extension : true), key: () => KEY, ...(options.askingState ? { askingState: options.askingState } : {}) }
  return { gate, reached, tool, deps, actions: nativeActions(deps), release: () => release() }
}

const ctx = (sessionID: string, agent = "atlas") => ({ sessionID, agent })
const settle = <T>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value }), (error: Error) => ({ ok: false as const, error: error.message }))
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe("B2: the read in jelly's shape", () => {
  test("driving names the task { id, title, startedAt } and the agent; ready names the agent only; nothing else", async () => {
    const { tool, gate, deps, actions, release } = setup()
    const running = settle(tool("execute", true)({}, ctx("ses_a")))
    await tick()
    expect(actions.connect(call("browser.connect", {}))).toBe(true)
    await tick()
    const [task] = gate.tasks()
    const driving = await browserStatus(deps)
    expect(driving).toEqual({ state: "driving", canControl: true, task: { id: task!.id, title: "Compare train fares", startedAt: task!.since }, agent: "atlas" })
    expect(Object.keys(driving.task!).sort()).toEqual(["id", "startedAt", "title"])
    release()
    await running
    expect(await browserStatus(deps)).toEqual({ state: "ready", canControl: true, agent: "atlas" })
    gate.dispose()
  })
})

describe("with nothing held or asked", () => {
  test("the extension reported not connected reads extension-needed; unknown or connected reads ready; neither offers control", async () => {
    expect(await browserStatus(setup({ extension: false }).deps)).toEqual({ state: "extension-needed", canControl: false })
    expect(await browserStatus(setup({ extension: undefined }).deps)).toEqual({ state: "ready", canControl: false })
    expect(await browserStatus(setup({ extension: true }).deps)).toEqual({ state: "ready", canControl: false })
  })

  test("only a running relay can say the extension is missing; a stopped one starts on demand", () => {
    const facts = (running: boolean, connected: boolean) => ({ relay: { running }, extension: { connected } })
    expect(extensionFact(facts(true, false))).toBe(false)
    expect(extensionFact(facts(true, true))).toBe(true)
    expect(extensionFact(facts(false, false))).toBeUndefined()
    expect(extensionFact(undefined)).toBeUndefined()
  })
})

describe("B3: asking with no task, riding along while a task holds the Chrome", () => {
  test("ASKING_STATE is not-connected until jelly draws asking, so jelly's Connect stays the way to allow", () => {
    expect(ASKING_STATE).toBe("not-connected")
  })

  test("with jelly's asking: no task is asking with the request; a task holding the Chrome keeps ready and Stop", async () => {
    const { tool, gate, deps, actions } = setup({ askingState: "asking" })
    void settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    const [ask] = gate.asks()
    expect(await browserStatus(deps)).toEqual({ state: "asking", canControl: true, request: { id: ask!.id, agent: "atlas", task: { title: "Compare train fares" }, scope: { sites: ["*"], mode: "act" }, expiresAt: ask!.expiresAt } })
    expect(actions.allow(call("browser.allow", { id: ask!.id }))).toBe(true)
    await tick()
    void settle(tool("execute")({}, ctx("ses_b", "harbor")))
    await tick()
    const status = await browserStatus(deps)
    expect(status.state).toBe("ready")
    expect(status.canControl).toBe(true)
    expect(status.agent).toBe("atlas")
    expect(status.request).toMatchObject({ agent: "harbor", scope: { mode: "act" } })
    gate.dispose()
  })

  test("the request runs out at expiresAt as Not now, and its id then answers REQUEST_EXPIRED", async () => {
    const { tool, gate, actions } = setup({ askTimeoutMs: 30 })
    const before = Date.now()
    const waiting = settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    const [ask] = gate.asks()
    expect(Date.parse(ask!.expiresAt) - before).toBeGreaterThanOrEqual(25)
    expect(Date.parse(ask!.expiresAt) - before).toBeLessThan(1_000)
    expect(await waiting).toMatchObject({ ok: false })
    expect(() => actions.allow(call("browser.allow", { id: ask!.id }))).toThrow(REQUEST_EXPIRED)
  })
})

describe("B3: the mode is enforced", () => {
  test("read mode is the read class of the plugin's own table; anything unclassified is act", () => {
    expect([...READ_TOOLS].sort()).toEqual(TOOLS.filter((tool) => tool.class === "read").map((tool) => tool.name).sort())
    expect([...READ_TOOLS].sort()).toEqual(["secrets_list", "secrets_status", "session_list", "status"])
    expect(modeOf("execute")).toBe("act")
    expect(modeOf("frobnicate")).toBe("act")
  })

  test("under a read grant a mutating tool and an unclassified one never reach the server; each asks to act", async () => {
    const { tool, gate, deps, actions, reached } = setup({ askTimeoutMs: 40 })
    const first = settle(tool("session_list")({}, ctx("ses_a")))
    await tick()
    const [ask] = gate.asks()
    expect(ask!.mode).toBe("read")
    expect(askText(gate, {})).toContain("to read only")
    expect(actions.allow(call("browser.allow", { id: ask!.id }))).toBe(true)
    expect(await first).toMatchObject({ ok: true })
    expect(await settle(tool("status")({}, ctx("ses_a")))).toMatchObject({ ok: true })
    for (const name of ["execute", "frobnicate"]) {
      const pending = settle(tool(name)({}, ctx("ses_a")))
      await tick()
      // The wider ask rides along on the read task; the person sees it is to act.
      expect((await browserStatus(deps)).request).toMatchObject({ agent: "atlas", scope: { mode: "act" } })
      const outcome = await pending
      expect(!outcome.ok && outcome.error, name).toStartWith("CHROME_NOT_ALLOWED:")
    }
    expect(reached).toEqual(["session_list", "status"])
    gate.dispose()
  })

  test("allowing the wider ask makes the same task act; declining it leaves the task reading", async () => {
    const { tool, gate, actions, reached } = setup()
    const first = settle(tool("status")({}, ctx("ses_a")))
    await tick()
    actions.allow(call("browser.allow", { id: gate.asks()[0]!.id }))
    await first
    const [task] = gate.tasks()
    const declined = settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    expect(actions.decline(call("browser.decline", { id: gate.asks()[0]!.id }))).toBe(true)
    expect(await declined).toMatchObject({ ok: false })
    expect(gate.tasks()[0]).toMatchObject({ id: task!.id, mode: "read" })
    const widened = settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    actions.allow(call("browser.allow", { id: gate.asks()[0]!.id }))
    expect(await widened).toMatchObject({ ok: true })
    expect(gate.tasks()[0]).toMatchObject({ id: task!.id, mode: "act" })
    expect(reached).toEqual(["status", "execute"])
    gate.dispose()
  })
})

describe("B3: allow and decline one request", () => {
  test("allow { id } lets that request's task through, and only that one", async () => {
    const { tool, gate, actions, reached } = setup()
    void settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    const b = settle(tool("execute")({}, ctx("ses_b", "harbor")))
    await tick()
    const second = gate.asks().find((ask) => ask.sessionID === "ses_b")!
    expect(actions.allow(call("browser.allow", { id: second.id }))).toBe(true)
    expect(await b).toMatchObject({ ok: true })
    expect(gate.tasks().map((task) => task.sessionID)).toEqual(["ses_b"])
    expect(reached).toEqual(["execute"])
    gate.dispose()
  })

  test("decline { id } is Not now: the waiting call is refused and nothing reached the server", async () => {
    const { tool, gate, actions, reached } = setup()
    const waiting = settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    const [ask] = gate.asks()
    expect(actions.decline(call("browser.decline", { id: ask!.id }))).toBe(true)
    const outcome = await waiting
    expect(!outcome.ok && outcome.error).toStartWith("CHROME_NOT_ALLOWED:")
    expect(reached).toEqual([])
    // Answered: a second answer to it has run out.
    expect(() => actions.allow(call("browser.allow", { id: ask!.id }))).toThrow(REQUEST_EXPIRED)
    expect(() => actions.decline(call("browser.decline", { id: ask!.id }))).toThrow(REQUEST_EXPIRED)
  })

  test("a request id this engine no longer knows (after a restart) has run out; an id it could never issue is not yours", async () => {
    const { tool, gate, actions } = setup()
    void settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    // A fresh gate is an engine restarted: the old request is forgotten.
    const restarted = setup()
    const old = gate.asks()[0]!.id
    expect(() => restarted.actions.allow(call("browser.allow", { id: old }))).toThrow(REQUEST_EXPIRED)
    expect(() => restarted.actions.decline(call("browser.decline", { id: old }))).toThrow(REQUEST_EXPIRED)
    expect(() => actions.allow(call("browser.allow", { id: "ask_000000000000000000000000" }))).toThrow(REQUEST_EXPIRED)
    for (const id of ["req_123", "ask_XYZ", ""]) {
      expect(() => actions.allow(call("browser.allow", { id })), id).toThrow(NOT_YOUR_REQUEST)
      expect(() => actions.decline(call("browser.decline", { id })), id).toThrow(NOT_YOUR_REQUEST)
    }
    expect(gate.tasks()).toEqual([])
    expect(gate.asks()).toHaveLength(1)
    // A grant for another request's id is refused before anything is allowed.
    expect(() => actions.allow({ input: { id: gate.asks()[0]!.id }, grant: grant("browser.allow", { id: "ask_other" }) })).toThrow()
    gate.dispose()
  })

  test("the RPC answers B3's error codes and texts", async () => {
    const { tool, gate, deps } = setup()
    let handlers: Record<string, (input: unknown, context: unknown) => Promise<unknown>> = {}
    registerNativeRpc({ register: ((_: unknown, given: typeof handlers) => (handlers = given)) as never }, deps)
    void settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    const id = gate.asks()[0]!.id
    const failed: [string, string][] = []
    const context = { error: (code: string, message: string) => failed.push([code, message]) }
    expect(await handlers["act.browser.decline"]!(call("browser.decline", { id }), context)).toBe(true)
    await handlers["act.browser.allow"]!(call("browser.allow", { id }), context)
    await handlers["act.browser.allow"]!(call("browser.allow", { id: "not-a-request" }), context)
    expect(failed).toEqual([
      ["REQUEST_EXPIRED", "REQUEST_EXPIRED: this request ran out. Next step: ask the agent to try again."],
      ["NOT_YOUR_REQUEST", NOT_YOUR_REQUEST],
    ])
    expect(NOT_YOUR_REQUEST).toStartWith("NOT_YOUR_REQUEST: ")
  })
})

describe("B3: no stale driving after the task ends", () => {
  test("the agent's end of the task, or Stop mid-call, reads ready with nothing held", async () => {
    const { tool, gate, deps, actions, release } = setup()
    const first = settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    actions.allow(call("browser.allow", { id: gate.asks()[0]!.id }))
    await first
    expect(await settle(tool("session_reset")({}, ctx("ses_a")))).toMatchObject({ ok: true })
    expect(await browserStatus(deps)).toEqual({ state: "ready", canControl: false })

    const again = settle(tool("execute", true)({}, ctx("ses_a")))
    await tick()
    actions.allow(call("browser.allow", { id: gate.asks()[0]!.id }))
    await tick()
    expect((await browserStatus(deps)).state).toBe("driving")
    expect(actions.stop(call("browser.stop", {}))).toBe(true)
    expect(await again).toMatchObject({ ok: false })
    release()
    expect(await browserStatus(deps)).toEqual({ state: "ready", canControl: false })
    gate.dispose()
  })
})

describe("B4: a content-free notice on every change of the read", () => {
  test("one personal-browser notice per change, none when the read is the same; off until jelly treats it as a signal", async () => {
    expect(RAISE_CHANGE_NOTICES).toBe(false)
    const filed: { body: Record<string, unknown>; keep: boolean }[] = []
    let raise = () => undefined as void
    const { tool, gate, deps, actions, release } = setup({ changed: () => raise() })
    raise = changeNotices({ request: async (input) => filed.push(input as never) }, () => browserStatus(deps))
    const settled = async () => {
      await tick()
      await tick()
    }
    const running = settle(tool("execute", true)({}, ctx("ses_a")))
    await settled()
    expect(filed).toHaveLength(1) // asking
    actions.allow(call("browser.allow", { id: gate.asks()[0]!.id }))
    await settled()
    expect(filed.length).toBeGreaterThanOrEqual(2) // ready, then driving as the call goes through
    const afterDriving = filed.length
    expect((await browserStatus(deps)).state).toBe("driving")
    release()
    await running
    await settled()
    expect(filed).toHaveLength(afterDriving + 1) // ready
    raise()
    await settled()
    expect(filed).toHaveLength(afterDriving + 1) // the same read: no notice
    actions.stop(call("browser.stop", {}))
    await settled()
    expect(filed).toHaveLength(afterDriving + 2) // ended
    for (const notice of filed) {
      expect(notice.body).toEqual({ package: PACKAGE_NAME, notice: CHANGE_NOTICE, key: expect.stringMatching(/^chg_[a-f0-9]{24}$/) })
      expect(notice.keep).toBe(false)
    }
    expect(new Set(filed.map((notice) => notice.body.key)).size).toBe(filed.length)
    gate.dispose()
  })
})

describe("the person reads your Chrome and the agent's name, never the plugin's (D76)", () => {
  test("no person-facing word of the personal-browser surface says Browse", async () => {
    const { tool, gate } = setup()
    void settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    const filed: unknown[] = []
    noticeAsk({ request: async (input) => filed.push(input) }, gate.asks()[0]!)
    await tick()
    const jelly = pkg.jelly
    const own = (names: string[], items: { name?: string; id?: string; label?: string; title?: string }[]) => items.filter((item) => names.includes(item.name ?? item.id ?? ""))
    const page = readFileSync(join(root, "views/browser.html"), "utf8")
    const visible = [
      ...page.matchAll(/"([^"]*[A-Z][^"]*)"/g),
      ...page.matchAll(/`([^`]*)`/g),
      ...page.matchAll(/>([^<]+)</g),
    ].map((match) => match[1]!).filter((text) => !/^(act|rpc)\.call$|^browser\.|^r\$|^use strict$/.test(text))
    const words = [
      ...own(["browser.status", "browser.ask", "browser.inbox"], jelly.rpc).map((item) => item.label),
      ...own(["browser.connect", "browser.stop", "browser.allow", "browser.decline"], jelly.actions).map((item) => item.label),
      ...own([ASK_NOTICE, CHANGE_NOTICE], jelly.notices).map((item) => item.label),
      ...own(["browser-native"], jelly.views).map((item) => item.title),
      askText(gate, {}),
      JSON.stringify(inboxItems(gate)),
      // The notice's words: its name and line (the package id is the plugin's, not words jelly says).
      (filed[0] as { body: { name: string } }).body.name,
      (filed[0] as { body: { line: string } }).body.line,
      REQUEST_EXPIRED,
      NOT_YOUR_REQUEST,
      ...visible,
    ]
    expect(words.length).toBeGreaterThan(20)
    for (const text of words) expect(String(text), String(text)).not.toMatch(/\bbrowse\b/i)
    expect(askText(gate, {})).toContain("atlas wants to use your Chrome")
    gate.dispose()
  })
})
