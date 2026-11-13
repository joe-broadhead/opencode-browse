// The person's Chrome, per task (issue #3): nothing reaches the browse server for a session the person has not
// allowed, a grant ends with its task, it is never reused by another session, and the person's Stop ends it.
import { describe, expect, test } from "bun:test"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { actionInputDigest, type ActionPublicKey } from "../../src/jelly/action-grant.js"
import { ChromeGate } from "../../src/jelly/chrome-gate.js"
import { ASK_NOTICE, browserStatus, gated, inboxItems, askText, nativeActions, noticeAsk, PACKAGE_NAME, registerGate, underJelly, type NativeDeps } from "../../src/jelly/native.js"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const KEY: ActionPublicKey = { kid: createHash("sha256").update("test-key").digest("base64url"), jwk: publicKey.export({ format: "jwk" }) as ActionPublicKey["jwk"] }

/** A grant as jelly's host signs one, with any claim overridden. */
function grant(action: string, input: unknown, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const head = part({ alg: "EdDSA", typ: "jelly-act+jwt", kid: KEY.kid, ...header })
  const body = part({ iss: "hst_test", aud: `${PACKAGE_NAME}#engine`, act: action, in: actionInputDigest(input), dev: "dev_test", mbr: "acc_test", cls: "local", iat: now, exp: now + 60, jti: randomBytes(16).toString("base64url"), ...claims })
  return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`
}

function setup(options: { askTimeoutMs?: number; idleMs?: number; now?: () => number; available?: boolean; asked?: (ask: { id: string }) => void } = {}) {
  const gate = new ChromeGate({ describe: async (sessionID) => `Book the train for ${sessionID}`, ...options })
  const calls: { tool: string; input: unknown }[] = []
  const tool = (name: string, result: unknown = { content: [] }) =>
    gated(gate, `browse_${name}`, async (input) => {
      calls.push({ tool: name, input })
      return result
    })
  const deps: NativeDeps = { gate, available: () => options.available ?? true, extensionConnected: async () => true, key: () => KEY }
  return { gate, calls, tool, deps, actions: nativeActions(deps) }
}

const ctx = (sessionID: string, agent = "atlas", signal?: AbortSignal) => ({ sessionID, agent, ...(signal ? { signal } : {}) })
const settle = <T>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value }), (error: Error) => ({ ok: false as const, error: error.message }))
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe("before the person answers", () => {
  test("no grant: the call waits, then is refused with no call to the server", async () => {
    const { tool, calls, gate } = setup({ askTimeoutMs: 30 })
    const outcome = await settle(tool("execute")({ code: "return 1" }, ctx("ses_a")))
    expect(outcome).toMatchObject({ ok: false })
    expect(!outcome.ok && outcome.error).toStartWith("CHROME_NOT_ALLOWED:")
    expect(calls).toEqual([])
    expect(gate.asks()).toEqual([])
  })

  test("the ask names the task, the agent and the sites, and is in the Inbox; the read offers Connect", async () => {
    const { tool, gate, deps } = setup()
    void settle(tool("session_new")({ id: "trains", allowedOrigins: ["trains.example", "pay.example"] }, ctx("ses_a")))
    await tick()
    const [ask] = gate.asks()
    expect(ask).toMatchObject({ sessionID: "ses_a", agent: "atlas", task: "Book the train for ses_a", origins: ["trains.example", "pay.example"] })
    expect(await browserStatus(deps)).toEqual({ state: "not-connected", canControl: true, ask: { id: ask!.id, agent: "atlas", task: ask!.task, origins: ask!.origins, at: ask!.at } })
    expect(askText(gate, {})).toContain("atlas wants to use your Chrome for this task: Book the train for ses_a. Sites: trains.example, pay.example.")
    expect(inboxItems(gate).items).toEqual([{ key: ask!.id, category: "request", kind: "chrome-ask", label: "Wants to use your Chrome", name: "atlas", line: "Book the train for ses_a (trains.example, pay.example)", at: ask!.at }])
    gate.dispose()
  })

  test("with no ask there is nothing to allow: no Connect, so the Chrome is never pre-allowed", async () => {
    const { deps, actions } = setup()
    expect(await browserStatus(deps)).toEqual({ state: "not-connected", canControl: false })
    expect(actions.connect({ input: {}, grant: grant("browser.connect", {}) })).toBe(false)
  })

  test("a cancelled call withdraws the ask", async () => {
    const { tool, gate, calls } = setup()
    const controller = new AbortController()
    const pending = settle(tool("execute")({ code: "1" }, ctx("ses_a", "atlas", controller.signal)))
    await tick()
    expect(gate.asks()).toHaveLength(1)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false })
    expect(gate.asks()).toEqual([])
    expect(calls).toEqual([])
  })

  test("managed mode or no binary: unavailable, and nothing to control", async () => {
    const { deps } = setup({ available: false })
    expect(await browserStatus(deps)).toEqual({ state: "unavailable", canControl: false })
  })
})

describe("Allow for this task", () => {
  test("a verified Connect lets the waiting call and the task's later calls through, and the read says driving", async () => {
    const { tool, calls, gate, deps, actions } = setup()
    let release: () => void = () => undefined
    const slow = gated(gate, "browse_execute", async (input) => {
      calls.push({ tool: "execute", input })
      await new Promise<void>((resolve) => (release = resolve))
      return { content: [] }
    })
    const first = settle(slow({ code: "1" }, ctx("ses_a")))
    await tick()
    const [ask] = gate.asks()
    expect(actions.connect({ input: { ask: ask!.id }, grant: grant("browser.connect", { ask: ask!.id }) })).toBe(true)
    await tick()
    expect(calls).toHaveLength(1)
    expect((await browserStatus(deps)).state).toBe("driving")
    release()
    expect(await first).toMatchObject({ ok: true })
    expect(await browserStatus(deps)).toMatchObject({ state: "ready", canControl: true, task: { agent: "atlas", task: "Book the train for ses_a", origins: null } })
    expect(await settle(tool("status")({}, ctx("ses_a")))).toMatchObject({ ok: true })
    expect(calls).toHaveLength(2)
  })

  test("jelly's Connect with {} allows the oldest ask, and only that one", async () => {
    const { tool, gate, actions, calls } = setup()
    const a = settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    void settle(tool("execute")({}, ctx("ses_b", "harbor")))
    await tick()
    expect(actions.connect({ input: {}, grant: grant("browser.connect", {}) })).toBe(true)
    expect(await a).toMatchObject({ ok: true })
    expect(gate.tasks().map((task) => task.sessionID)).toEqual(["ses_a"])
    expect(gate.asks().map((ask) => ask.sessionID)).toEqual(["ses_b"])
    expect(calls).toHaveLength(1)
    gate.dispose()
  })

  test("a Connect without the host's grant is refused before anything is allowed", async () => {
    const { tool, gate, actions } = setup()
    void settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    const other = generateKeyPairSync("ed25519").privateKey
    const forged = (() => {
      const [head, body] = grant("browser.connect", {}).split(".")
      return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), other).toString("base64url")}`
    })()
    const attempts: [unknown, string][] = [
      [{ input: {} }, "no grant"],
      [{ input: {}, grant: forged }, "another key"],
      [{ input: {}, grant: grant("browser.stop", {}) }, "another action"],
      [{ input: {}, grant: grant("browser.connect", { ask: "ask_000000000000000000000000" }) }, "another input"],
      [{ input: {}, grant: grant("browser.connect", {}, { aud: "other#engine" }) }, "another plugin"],
      [{ input: {}, grant: grant("browser.connect", {}, { cls: "chat" }) }, "a paired phone"],
      [{ input: {}, grant: grant("browser.connect", {}, { iat: 1, exp: 61 }) }, "expired"],
    ]
    for (const [call, why] of attempts) expect(() => actions.connect(call), why).toThrow()
    const once = grant("browser.connect", {})
    expect(actions.connect({ input: {}, grant: once })).toBe(true)
    gate.stop()
    void settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    expect(() => actions.connect({ input: {}, grant: once }), "a spent grant").toThrow("used already")
    gate.dispose()
  })
})

describe("the grant lasts for the task only", () => {
  async function allowed(sessionID = "ses_a", agent = "atlas", origins?: string[]) {
    const env = setup({ askTimeoutMs: 30 })
    const first = settle(env.tool(origins ? "session_new" : "execute")(origins ? { id: "t", allowedOrigins: origins } : {}, ctx(sessionID, agent)))
    await tick()
    env.gate.allow()
    expect(await first).toMatchObject({ ok: true })
    env.calls.length = 0
    return env
  }

  test("the agent's session_reset ends it: the next call asks again and reaches nothing", async () => {
    const { tool, calls, gate } = await allowed()
    expect(await settle(tool("session_reset")({}, ctx("ses_a")))).toMatchObject({ ok: true })
    expect(gate.tasks()).toEqual([])
    expect(await settle(tool("execute")({}, ctx("ses_a")))).toMatchObject({ ok: false })
    expect(calls.map((call) => call.tool)).toEqual(["session_reset"])
  })

  test("session_delete ends it too; a failed reset does not", async () => {
    const env = await allowed()
    await settle(gated(env.gate, "browse_session_reset", async () => ({ isError: true, content: [] }))({}, ctx("ses_a")))
    expect(env.gate.tasks()).toHaveLength(1)
    await settle(env.tool("session_delete")({}, ctx("ses_a")))
    expect(env.gate.tasks()).toEqual([])
  })

  test("a stale grant is not reused by another session, or by another agent in the same session", async () => {
    const { tool, calls } = await allowed()
    expect(await settle(tool("execute")({}, ctx("ses_b")))).toMatchObject({ ok: false })
    expect(await settle(tool("execute")({}, ctx("ses_a", "harbor")))).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })

  test("the person's Stop (a verified browser.stop) ends it at once", async () => {
    const { tool, calls, gate, deps, actions } = await allowed()
    expect(actions.stop({ input: {}, grant: grant("browser.stop", {}) })).toBe(true)
    expect(gate.tasks()).toEqual([])
    expect(await browserStatus(deps)).toEqual({ state: "not-connected", canControl: false })
    expect(await settle(tool("execute")({}, ctx("ses_a")))).toMatchObject({ ok: false })
    expect(calls).toEqual([])
    expect(() => actions.stop({ input: {}, grant: grant("browser.connect", {}) })).toThrow()
  })

  test("Stop for one session leaves another's task alone", async () => {
    const env = await allowed()
    const b = settle(env.tool("execute")({}, ctx("ses_b", "harbor")))
    await tick()
    env.gate.allow()
    await b
    env.actions.stop({ input: { session: "ses_a" }, grant: grant("browser.stop", { session: "ses_a" }) })
    expect(env.gate.tasks().map((task) => task.sessionID)).toEqual(["ses_b"])
  })

  test("an hour with no browse call ends it; the session ending or the plugin stopping ends it", async () => {
    let now = 1_000_000
    const gate = new ChromeGate({ describe: async () => "t", now: () => now, askTimeoutMs: 30 })
    const call = gated(gate, "browse_execute", async () => ({ content: [] }))
    const first = settle(call({}, ctx("ses_a")))
    await tick()
    gate.allow()
    await first
    now += 60 * 60_000
    expect(gate.tasks()).toEqual([])
    const again = settle(call({}, ctx("ses_a")))
    await tick()
    gate.allow()
    await again
    expect(gate.end("ses_a", "session-ended")).toBe(true)
    const third = settle(call({}, ctx("ses_a")))
    await tick()
    gate.allow()
    await third
    gate.dispose()
    expect(gate.tasks()).toEqual([])
    expect(await settle(call({}, ctx("ses_a")))).toMatchObject({ ok: false })
  })

  test("the sites: a new session gets the allowed ones, and a wider one is refused", async () => {
    const { tool, calls } = await allowed("ses_a", "atlas", ["trains.example"])
    expect(await settle(tool("session_new")({ id: "second" }, ctx("ses_a")))).toMatchObject({ ok: true })
    expect(calls[0]!.input).toEqual({ id: "second", allowedOrigins: ["trains.example"] })
    const wider = await settle(tool("session_allowlist")({ allowedOrigins: ["bank.example"] }, ctx("ses_a")))
    expect(!wider.ok && wider.error).toStartWith("CHROME_SCOPE:")
    const cleared = await settle(tool("session_allowlist")({ allowedOrigins: [] }, ctx("ses_a")))
    expect(!cleared.ok && cleared.error).toStartWith("CHROME_SCOPE:")
    expect(calls).toHaveLength(1)
  })
})

describe("a second ask while a task holds the Chrome", () => {
  test("the waiting ask is shown first and can be allowed; the running task is still reported and untouched", async () => {
    const { tool, gate, deps, actions, calls } = setup()
    const a = settle(tool("execute")({}, ctx("ses_a")))
    await tick()
    gate.allow()
    await a
    // A subagent's conversation, or another one, asks while ses_a holds the grant.
    const b = settle(tool("execute")({}, ctx("ses_sub", "atlas-helper")))
    await tick()
    const status = await browserStatus(deps)
    expect(status.state).toBe("not-connected")
    expect(status.canControl).toBe(true)
    expect(status.ask).toMatchObject({ agent: "atlas-helper" })
    expect(status.task).toMatchObject({ agent: "atlas" })
    // jelly's Connect sends {}: it allows the waiting ask, not nothing.
    expect(actions.connect({ input: {}, grant: grant("browser.connect", {}) })).toBe(true)
    expect(await b).toMatchObject({ ok: true })
    expect(gate.tasks().map((task) => task.sessionID).sort()).toEqual(["ses_a", "ses_sub"])
    expect(calls).toHaveLength(2)
  })
})

describe("every tool of the server is gated", () => {
  test("an unclassified browse tool, or one in the browse namespace, waits behind the gate; another server's does not", async () => {
    const gate = new ChromeGate({ describe: async () => "t", askTimeoutMs: 30 })
    const reached: string[] = []
    const tools = ["browse_new_tool", "browse_status", "other_tool", "renamed"].map((id) => ({
      id,
      ...(id === "renamed" ? { options: { namespace: "browse" } } : {}),
      execute: async () => {
        reached.push(id)
        return { content: [] }
      },
    }))
    const editor = {
      list: () => tools,
      update: (id: string, change: (info: (typeof tools)[number]) => void) => change(tools.find((item) => item.id === id)!),
    }
    await registerGate({ transform: async (callback: (value: never) => void) => (callback(editor as never), { dispose: async () => undefined }) } as never, gate)
    for (const item of tools) await settle((item.execute as (input: unknown, context: unknown) => Promise<unknown>)({}, ctx("ses_a")))
    expect(reached).toEqual(["other_tool"])
  })
})

describe("Stop ends a call already running", () => {
  test("a long call is aborted with the grant, and its signal says so", async () => {
    const { gate, actions } = setup()
    let seen: AbortSignal | undefined
    const long = gated(gate, "browse_execute", (_input, context) => {
      seen = context.signal
      return new Promise(() => undefined)
    })
    const first = settle(long({}, ctx("ses_a")))
    await tick()
    gate.allow()
    await tick()
    expect(seen?.aborted).toBe(false)
    expect(actions.stop({ input: {}, grant: grant("browser.stop", {}) })).toBe(true)
    const outcome = await first
    expect(!outcome.ok && outcome.error).toStartWith("CHROME_NOT_ALLOWED:")
    expect(seen?.aborted).toBe(true)
    expect(gate.driving()).toBe(false)
  })

  test("the idle limit and the task's end abort a running call too", async () => {
    const { gate } = setup()
    let seen: AbortSignal | undefined
    const long = gated(gate, "browse_execute", (_input, context) => ((seen = context.signal), new Promise(() => undefined)))
    const first = settle(long({}, ctx("ses_a")))
    await tick()
    gate.allow()
    await tick()
    gate.end("ses_a", "session-ended")
    expect(await first).toMatchObject({ ok: false })
    expect(seen?.aborted).toBe(true)
  })
})

describe("the ask reaches the person through jelly's notice", () => {
  test("one notice per ask, with the declared notice, the ask as its key, and the agent and task", async () => {
    const asked: { id: string }[] = []
    const { tool, gate } = setup({ asked: (ask) => asked.push(ask) })
    void settle(tool("execute")({}, ctx("ses_a")))
    void settle(tool("status")({}, ctx("ses_a")))
    await tick()
    expect(asked).toHaveLength(1)
    const filed: unknown[] = []
    noticeAsk({ request: async (input) => filed.push(input) }, gate.asks()[0]!)
    await tick()
    expect(filed).toEqual([
      { id: expect.stringMatching(/^browse-[a-f0-9]{24}$/), kind: "notice", body: { package: PACKAGE_NAME, notice: ASK_NOTICE, key: asked[0]!.id, name: "atlas", line: "Book the train for ses_a (any site)" }, keep: false },
    ])
    // A refusal or no jelly at all changes nothing.
    noticeAsk({ request: async () => Promise.reject(new Error("no jelly")) }, gate.asks()[0]!)
    noticeAsk((() => { throw new Error("no rpc") }) as never, gate.asks()[0]!)
    await tick()
    expect(gate.asks()).toHaveLength(1)
    gate.dispose()
  })
})

test("jelly is recognised by its engine hand-off, and nothing else", () => {
  expect(underJelly({})).toBe(false)
  expect(underJelly({ [Symbol.for("jelly.engine-seal")]: {} })).toBe(true)
  expect(underJelly({ [Symbol.for("jelly.action-key")]: KEY })).toBe(true)
})
