import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { cleanup, attempt, effect, modelReady, modelSession, modelTurn, session, startHost, until } from "./harness.js"
import { NEW_TOOL, REAL_TOOLS } from "./fake-browse.js"
import { PINNED_VERSION } from "../../src/constants.js"
import { resolveBinary } from "../../src/provider/binary.js"
import { pinnedBinary } from "../support/pinned.js"
import { relayVersion, stopRelaySafely } from "../../src/provider/relay.js"
import { assertNoRelayLeft, relayPidsForHome } from "../support/relays.js"

// Each test starts a real host on a stock server; a busy machine needs more than Bun's default 5 s.
setDefaultTimeout(120_000)
afterAll(cleanup)

describe("registering the server", () => {
  test("a fresh install: the pinned command runs, and the browser tools arrive beside status and report", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const tools = await host.probe().tool.list()
      const inNamespace = tools.filter((tool) => tool.options?.namespace === "browse")
      // The server's own `status` tool shares its effective name with the contract's `status` method; the plugin's
      // tool owns `browse_status`, and `report` carries the details. The other 17 server tools keep their names.
      expect(inNamespace.find((tool) => tool.id === "browse_status")?.options?.permission).toBe("browse.status")
      expect(inNamespace.find((tool) => tool.id === "browse_report")?.options?.permission).toBe("browse.report")
      for (const tool of REAL_TOOLS.map((entry) => entry.name).filter((name) => name !== "status")) {
        expect({ tool, found: inNamespace.some((entry) => entry.id === `browse_${tool}`) }).toEqual({ tool, found: true })
      }
      expect(inNamespace).toHaveLength(19)
      // The project is empty and its config has no `mcp.servers` entry (the harness's isolated HOME and XDG keep any
      // user config out), so the one `browse` server in the list is the plugin's own registration, and it is connected.
      const { data: servers } = await host.client.mcp.list({ location: host.location })
      const browseServers = servers.filter((server) => server.name === "browse")
      expect(browseServers).toHaveLength(1)
      expect(browseServers[0]?.status.status).toBe("connected")
      expect(host.fake.calls().some((call) => call.kind === "tool")).toBe(false)
    } finally {
      await host.close()
    }
  })

  test("the installer's own entry is adopted, not duplicated", async () => {
    const host = await startHost({
      options: { verifyBinary: false },
      config: { mcp: { servers: { browse: { type: "local", command: ["node", "global/@opencode/browse/dist/cli.mjs", "mcp"] } } } },
    })
    try {
      const { data: servers } = await host.client.mcp.list({ location: host.location })
      expect(servers.filter((server) => server.name === "browse")).toHaveLength(1)
      const names = (await host.probe().tool.list()).filter((tool) => tool.options?.namespace === "browse")
      expect(names).toHaveLength(19)
    } finally {
      await host.close()
    }
  })

  test("an entry that is not browse is a conflict: no browse tools", async () => {
    const host = await startHost({
      options: { verifyBinary: false },
      config: { mcp: { servers: { browse: { type: "local", command: ["node", "not-browse/mcp.js"] } } } },
      expectTools: false,
    })
    try {
      const names = (await host.probe().tool.list()).filter((tool) => tool.options?.namespace === "browse")
      // The plugin's own methods stay: the conflict is about the server it will not register.
      expect(names.map((tool) => tool.id).sort()).toEqual(["browse_report", "browse_status"])
    } finally {
      await host.close()
    }
  })
})

describe("review findings, through the host", () => {
  test("DR-4: a bad option still loads the plugin, with no server and no tools", async () => {
    const host = await startHost({ options: { nope: 1 } as Record<string, unknown>, expectTools: false })
    try {
      const { data: plugins } = await host.client.plugin.list({ location: host.location })
      expect(plugins.find((plugin) => plugin.id === "browse")?.state?.status).toBe("active")
      const { data: servers } = await host.client.mcp.list({ location: host.location })
      expect(servers.find((server) => server.name === "browse")).toBeUndefined()
    } finally {
      await host.close()
    }
  })
})

describe("the contract's doors", () => {
  test("status and report answer over RPC, and neither takes an account", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const status = await host.call("status", {})
      expect(status.ok).toBe(true)
      if (status.ok) {
        expect(status.output).toMatchObject({ name: "browse", version: "0.0.0", accounts: [], state: "ready" })
        expect(typeof (status.output as { nextStep?: unknown }).nextStep).toBe("string")
      }
      const report = await host.call("report", {})
      expect(report.ok).toBe(true)
      if (report.ok) expect(report.output).toMatchObject({ version: "0.0.0", mode: "real", unguardedAgents: [] })
      // The manifest declares every method `accounts: none`. The RPC envelope validates the input against the method's
      // schema before the register sees it, so an account field is refused as `rpc.invalid_input`; the register's own
      // refusal for the same field is `INPUT_INVALID`. Either way the call does not run.
      const withAccount = await host.call("status", { account: "work" })
      expect(withAccount.ok).toBe(false)
      if (!withAccount.ok) expect(["INPUT_INVALID", "rpc.invalid_input"]).toContain(withAccount.code)
    } finally {
      await host.close()
    }
  })
})

describe("the permission table, through the host", () => {
  test("the reads and the captures run with no prompt", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const sessionID = await session(host)
      // `browse_status` is the plugin's own status: the contract's `status` method owns the name and shadows the
      // server's own `status` tool on OpenCode 2.4.1 (see docs/capabilities.md). `report` carries the details.
      for (const tool of ["report", "session_list", "secrets_list", "secrets_status", "tabs_cleanup", "network", "recording", "flight_recorder"]) {
        const result = await attempt(host, sessionID, "build", tool, "reject")
        expect({ tool, asked: result.asked }).toEqual({ tool, asked: undefined })
        expect({ tool, ok: result.ok }).toEqual({ tool, ok: true })
      }
      expect(host.fake.tools().sort()).toEqual(["flight_recorder", "network", "recording", "secrets_list", "secrets_status", "session_list", "tabs_cleanup"].sort())
    } finally {
      await host.close()
    }
  })

  test("execute runs by default, and an agent that asks gets its prompt, whose decline runs nothing", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const allowed = await session(host)
      const ran = await attempt(host, allowed, "build", "execute", "reject", { code: "return 1" })
      expect(ran.asked).toBeUndefined()
      expect(ran.ok).toBe(true)
      expect(host.fake.tools()).toContain("execute")

      const asking = await host.client.session.create({ location: host.location, agent: "build", permissions: [{ action: "browse_execute", resource: "*", effect: "ask" }] })
      const declined = await attempt(host, asking.id, "build", "execute", "reject", { code: "return 1" })
      expect(declined.asked).toBe("browse_execute")
      expect(declined.ok).toBe(false)
    } finally {
      await host.close()
    }
  })

  test("secrets_run, secrets_refresh, session_allowlist and session_new run by default", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const sessionID = await session(host)
      for (const tool of ["secrets_run", "secrets_refresh", "session_allowlist", "session_new"]) {
        const result = await attempt(host, sessionID, "build", tool, "reject")
        expect({ tool, asked: result.asked }).toEqual({ tool, asked: undefined })
        expect({ tool, ok: result.ok }).toEqual({ tool, ok: true })
      }
      expect(host.fake.tools()).toContain("secrets_run")
    } finally {
      await host.close()
    }
  })

  test("every known name resolves to allow, and an unknown name runs on the namespace rule", async () => {
    const host = await startHost({ options: { verifyBinary: false }, fake: { tools: [...REAL_TOOLS, NEW_TOOL] } })
    try {
      const { manifest } = await import("../../src/manifest.js")
      const tools = Object.keys(manifest.methods).filter((method) => method.startsWith("mcp:")).map((method) => method.slice(4))
      for (const tool of tools) expect({ tool, effect: await effect(host, "build", `browse_${tool}`) }, tool).toEqual({ tool, effect: "allow" })
      // The namespace pattern allows a tool the table does not know yet, so it is usable at once.
      expect(await effect(host, "build", "browse_shiny_new_tool")).toBe("allow")
      const sessionID = await session(host)
      const ran = await attempt(host, sessionID, "build", "shiny_new_tool", "reject")
      expect(ran.asked).toBeUndefined()
      expect(ran.ok).toBe(true)
      expect(host.fake.tools()).toContain("shiny_new_tool")
    } finally {
      await host.close()
    }
  })

  // R18: one host case per restricting value. `all` is the default and is proved above.
  test("access ask-changes makes execute ask and runs nothing when declined", async () => {
    const host = await startHost({ options: { verifyBinary: false, access: "ask-changes" } })
    try {
      const sessionID = await session(host)
      const read = await attempt(host, sessionID, "build", "status", "reject")
      expect(read).toMatchObject({ asked: undefined, ok: true })
      const before = host.fake.tools().length
      const asked = await attempt(host, sessionID, "build", "execute", "reject", { code: "return 1" })
      expect(asked.asked).toBe("browse_execute")
      expect(asked.ok).toBe(false)
      expect(host.fake.tools()).toHaveLength(before)
    } finally {
      await host.close()
    }
  })

  test("access read-only denies execute with no prompt and no server call", async () => {
    const host = await startHost({ options: { verifyBinary: false, access: "read-only" } })
    try {
      const sessionID = await session(host)
      expect(await effect(host, "build", "browse_execute")).toBe("deny")
      const before = host.fake.tools().length
      const denied = await attempt(host, sessionID, "build", "execute", "reject", { code: "return 1" })
      expect(denied.asked).toBeUndefined()
      expect(denied.ok).toBe(false)
      expect(host.fake.tools()).toHaveLength(before)
    } finally {
      await host.close()
    }
  })
})

describe("Code Mode", () => {
  test("a tools.browse read runs inside the program, and execute runs under the default allow", async () => {
    const host = await startHost({ options: { verifyBinary: false }, model: true })
    try {
      await modelReady(host)
      host.model!.script = [
        {
          tool: "execute",
          arguments: {
            code: [
              "const results = []",
              "results.push(String((await tools.browse.report({})) !== undefined))",
              "try { await tools.browse.execute({ code: 'return 1' }); results.push('ran') } catch (error) { results.push('refused') }",
              "return results",
            ].join("\n"),
          },
        },
      ]
      const sessionID = await modelSession(host)
      const answered = await modelTurn(host, sessionID, "Check the browser.")
      // Every tool is allowed by default, so the inner execute runs too. The turn is over when the model stops
      // answering, which can be a moment before the program's last call lands, so wait for the call itself.
      await until("the program's execute reaches the server", async () => host.fake.tools().includes("execute"), 30_000)
      expect(answered).toEqual([])
    } finally {
      await host.close()
    }
  }, 120_000)

  // R2 on the Code Mode path: a rule that asks is refused, and a rule that denies is refused, with no server call.
  test("R2: an ask and a deny inside execute are refused, and the server is never called", async () => {
    const host = await startHost({ options: { verifyBinary: false }, model: true })
    try {
      await modelReady(host)
      host.model!.script = [
        {
          tool: "execute",
          arguments: {
            code: [
              "const results = []",
              "try { await tools.browse.status({}); results.push('ran') } catch (error) { results.push('refused') }",
              "return results",
            ].join("\n"),
          },
        },
      ]
      // The plugin's own status is permitted as `browse.status`; the server's tools keep `browse_<tool>`.
      const asking = await modelSession(host, "build", [{ action: "browse.status", resource: "*", effect: "ask" }])
      const before = host.fake.tools().length
      const prompts = await modelTurn(host, asking, "Check the browser.")
      expect(prompts).toContain("browse.status")
      expect(host.fake.tools()).toHaveLength(before)

      const denying = await modelSession(host, "build", [{ action: "browse.status", resource: "*", effect: "deny" }])
      const promptsDenied = await modelTurn(host, denying, "Check the browser.")
      expect(promptsDenied).toEqual([])
      expect(host.fake.tools()).toHaveLength(before)
    } finally {
      await host.close()
    }
  }, 180_000)
})

describe("the relay a real-mode host starts", () => {
  test("is stopped by the plugin's own command, and another version is refused first", async () => {
    // The pinned binary is fetched and verified into .cache/bin by `npm run bin:ensure`; the relay test requires it.
    const pinned = pinnedBinary()
    if (pinned === undefined) throw new Error("the pinned browse binary is not in .cache/bin: run npm run bin:ensure")
    const host = await startHost({ packagedBinary: true })
    try {
      const sessionID = await session(host)
      // The first tool that needs the browser starts the relay; with no extension it still comes up.
      const started = await attempt(host, sessionID, "build", "execute", "once", { code: "return 1" })
      // Every tool is allowed by default, so the call reaches the relay with no prompt. It may still fail for want of a
      // paired extension; what this test is about is the relay the call starts.
      expect(started.asked).toBeUndefined()
      await until("the relay answers", async () => (await relayVersion()) !== undefined, 60_000)
      // The cleanup helper's process pattern is real: the relay the call started is one of this HOME's `browse serve` pids.
      const relay = await relayVersion()
      expect(relay?.pid ?? 0).toBeGreaterThan(1)
      expect(relayPidsForHome()).toContain(relay!.pid!)

      const binary = await resolveBinary({ optionPath: pinned })
      const refused = await stopRelaySafely({ expectedVersion: "0.0.0", binaryPath: binary.path })
      expect(refused.state).toBe("refused")
      expect(await relayVersion()).toBeDefined()

      const stopped = await stopRelaySafely({ expectedVersion: PINNED_VERSION, binaryPath: binary.path })
      expect(stopped.state).toBe("stopped")
      expect(await relayVersion()).toBeUndefined()
      expect(relayPidsForHome()).toEqual([])
      assertNoRelayLeft()
    } finally {
      await host.close()
    }
  }, 180_000)
})

describe("the scoped profile", () => {
  test("pins a read-only session, and denies the tools that could leave it", async () => {
    const host = await startHost({ options: { verifyBinary: false, scope: { session: "opencode", readOnly: true, allowedOrigins: ["github.com"] } } })
    try {
      const created = host.fake.calls().find((call) => call.kind === "session" && call.command === "new")
      expect(created).toMatchObject({ id: "opencode", readOnly: true, allowedOrigins: ["github.com"] })
      expect(await effect(host, "build", "browse_session_new")).toBe("deny")
      expect(await effect(host, "build", "browse_session_allowlist")).toBe("deny")
      expect(await effect(host, "build", "browse_execute")).toBe("allow")
      expect(await effect(host, "build", "browse_session_reset")).toBe("allow")
    } finally {
      await host.close()
    }
  })

  test("a writable scope still asks for execute", async () => {
    const host = await startHost({ options: { verifyBinary: false, scope: { session: "opencode" } } })
    try {
      expect(await effect(host, "build", "browse_execute")).toBe("ask")
      expect(host.fake.calls().find((call) => call.kind === "session" && call.command === "new")).toMatchObject({ id: "opencode", readOnly: false })
    } finally {
      await host.close()
    }
  })
})
