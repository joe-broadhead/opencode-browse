import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { cleanup, attempt, effect, modelReady, modelSession, modelTurn, session, startHost, until } from "./harness.js"
import { NEW_TOOL, REAL_TOOLS } from "./fake-browse.js"
import { PINNED_VERSION } from "../../src/constants.js"
import { resolveBinary } from "../../src/engine.js"
import { relayVersion, stopRelaySafely } from "../../src/managed/relay.js"
import { assertNoRelayLeft, relayPidsForHome } from "../support/relays.js"

// Each test starts a real host on a stock server; a busy machine needs more than Bun's default 5 s.
setDefaultTimeout(120_000)
afterAll(cleanup)

describe("registering the server", () => {
  test("a fresh install: the pinned command runs, and the 18 tools arrive", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const tools = await host.probe().tool.list()
      const names = tools.filter((tool) => tool.options?.namespace === "browse").map((tool) => tool.name)
      expect(names.sort()).toEqual(REAL_TOOLS.map((tool) => tool.name).sort())
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
      expect(names).toHaveLength(18)
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
      expect(names).toHaveLength(0)
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

describe("the permission table, through the host", () => {
  test("the reads and the captures run with no prompt", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const sessionID = await session(host)
      for (const tool of ["status", "session_list", "secrets_list", "secrets_status", "tabs_cleanup", "network", "recording", "flight_recorder"]) {
        const result = await attempt(host, sessionID, "build", tool, "reject")
        expect({ tool, asked: result.asked }).toEqual({ tool, asked: undefined })
        expect({ tool, ok: result.ok }).toEqual({ tool, ok: true })
      }
      expect(host.fake.tools().sort()).toEqual(["flight_recorder", "network", "recording", "secrets_list", "secrets_status", "session_list", "status", "tabs_cleanup"].sort())
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
      const { TOOLS } = await import("../../src/browse-tools.js")
      for (const tool of TOOLS) expect({ tool: tool.name, effect: await effect(host, "build", `browse_${tool.name}`) }, tool.name).toEqual({ tool: tool.name, effect: "allow" })
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
})

describe("Code Mode", () => {
  test("a tools.browse read runs inside the program, and an inner execute asks and never reaches the server", async () => {
    const host = await startHost({ options: { verifyBinary: false }, model: true })
    try {
      await modelReady(host)
      host.model!.script = [
        {
          tool: "execute",
          arguments: {
            code: [
              "const results = []",
              "results.push(String((await tools.browse.status({})) !== undefined))",
              "try { await tools.browse.execute({ code: 'return 1' }); results.push('ran') } catch (error) { results.push('refused') }",
              "return results",
            ].join("\n"),
          },
        },
      ]
      const sessionID = await modelSession(host)
      const answered = await modelTurn(host, sessionID, "Check the browser.")
      // Every tool is allowed by default, so the inner execute runs too.
      expect(answered).toBeDefined()
      expect(host.fake.tools()).toContain("status")
      expect(host.fake.tools()).toContain("execute")
    } finally {
      await host.close()
    }
  }, 120_000)
})

describe("the relay a real-mode host starts", () => {
  test("is stopped by the plugin's own command, and another version is refused first", async () => {
    // The packaged binary comes from the platform package, which `scripts/build-bins.mjs --local` installs from the
    // pinned download. Without it the host cannot start, so say so out loud rather than fail a fresh clone.
    if (resolveBinary().source !== "package") {
      const message = "skip: the packaged browse binary is not installed; run node scripts/build-bins.mjs --local"
      if (process.env.CI === "true" || process.env.CI === "1") throw new Error(message)
      console.log(message)
      return
    }
    const host = await startHost({ packagedBinary: true })
    try {
      const sessionID = await session(host)
      // The first tool that needs the browser starts the relay; with no extension it still comes up.
      const started = await attempt(host, sessionID, "build", "execute", "once", { code: "return 1" })
      // Every tool is allowed by default, so the call reaches the relay with no prompt. It may still fail for want of a
      // paired extension; what this test is about is the relay the call starts.
      expect(started.asked).toBeUndefined()
      await until("the relay answers", async () => (await relayVersion()) !== undefined, 60_000)

      const binary = resolveBinary()
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
