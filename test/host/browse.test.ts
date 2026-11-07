import { afterAll, describe, expect, test } from "bun:test"
import { cleanup, attempt, effect, modelReady, modelSession, modelTurn, session, startHost } from "./harness.js"
import { NEW_TOOL, REAL_TOOLS } from "./fake-browse.js"

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

  test("DR-5: a legacy opencode-browser server's tools are denied by exact-name pattern", async () => {
    const host = await startHost({
      options: { verifyBinary: false },
      config: { mcp: { servers: { "opencode-browser": { type: "local", command: ["node", "legacy/mcp.js"] } } } },
    })
    try {
      expect(await effect(host, "build", "opencode_browser_execute")).toBe("deny")
      expect(await effect(host, "build", "opencode_browser_network")).toBe("deny")
    } finally {
      await host.close()
    }
  })
})

describe("the owner's permission table, through the host", () => {
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

  test("execute asks, and a decline runs nothing", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const sessionID = await session(host)
      const declined = await attempt(host, sessionID, "build", "execute", "reject", { code: "return 1" })
      expect(declined.asked).toBe("browse_execute")
      expect(declined.ok).toBe(false)
      expect(host.fake.tools()).not.toContain("execute")

      const accepted = await attempt(host, sessionID, "build", "execute", "once", { code: "return 1" })
      console.log("DBG accepted", JSON.stringify(accepted))
      expect(accepted.asked).toBe("browse_execute")
      expect(accepted.ok).toBe(true)
      expect(host.fake.tools()).toContain("execute")
    } finally {
      await host.close()
    }
  })

  test("secrets_run and secrets_refresh ask", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      const sessionID = await session(host)
      for (const tool of ["secrets_run", "secrets_refresh", "session_allowlist", "session_new"]) {
        const result = await attempt(host, sessionID, "build", tool, "reject")
        expect({ tool, asked: result.asked }).toEqual({ tool, asked: `browse_${tool}` })
        expect({ tool, ok: result.ok }).toEqual({ tool, ok: false })
      }
      expect(host.fake.tools()).not.toContain("secrets_run")
    } finally {
      await host.close()
    }
  })

  test("every known name resolves to its effect, and no unknown name runs", async () => {
    const host = await startHost({ options: { verifyBinary: false }, fake: { tools: [...REAL_TOOLS, NEW_TOOL] } })
    try {
      const { TOOLS } = await import("../../src/browse-tools.js")
      for (const tool of TOOLS) expect({ tool: tool.name, effect: await effect(host, "build", `browse_${tool.name}`) }, tool.name).toEqual({ tool: tool.name, effect: tool.effect })
      expect(await effect(host, "build", "browse_shiny_new_tool")).toBe("deny")
      const sessionID = await session(host)
      const refusal = await attempt(host, sessionID, "build", "shiny_new_tool", "always")
      expect(refusal.ok).toBe(false)
      expect(refusal.asked).toBeUndefined()
      expect(host.fake.tools()).not.toContain("shiny_new_tool")
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
      const asked = await modelTurn(host, sessionID, "Check the browser.")
      expect(asked).toContain("browse_execute")
      expect(host.fake.tools()).toContain("status")
      expect(host.fake.tools()).not.toContain("execute")
    } finally {
      await host.close()
    }
  }, 120_000)
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
      expect(await effect(host, "build", "browse_session_reset")).toBe("ask")
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
