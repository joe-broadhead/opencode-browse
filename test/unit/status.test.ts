import { describe, expect, test } from "bun:test"
import { buildStatus, formatStatus, registerStatusRpc, StatusRpc, type StatusFacts } from "../../src/status.js"
import { defaultRules } from "../../src/permissions.js"

const host = { version: "2.2.4", range: ">=2.2.3 <2.3.0", tested: true }
const rules = { access: "all" as const, scoped: false, readOnly: false }
const binary = { path: "/opt/browse", version: "0.0.15", source: "package" as const, verified: true, tested: true, supported: true }

const facts = (overrides: Partial<StatusFacts> = {}): StatusFacts => ({ host, rules, binary, mode: "real", probe: { version: "0.0.15", tested: true }, ...overrides })

describe("buildStatus", () => {
  test("with no binary: not configured, and its own next step", () => {
    const status = buildStatus(facts({ binary: { path: null, version: null, source: null, verified: false, tested: false, supported: false }, binaryProblem: "BINARY_MISSING: The pinned browse binary is missing from its platform package. Next step: Reinstall the plugin." }))
    expect(status.state).toBe("not_configured")
    expect(status.nextStep).toContain("Reinstall the plugin")
    expect(status.problems[0]).toStartWith("BINARY_MISSING")
  })

  test("a tampered binary is failed", () => {
    const status = buildStatus(facts({ binaryProblem: "BINARY_UNVERIFIED: The browse binary does not match its pinned SHA-256. Next step: Reinstall the plugin." }))
    expect(status.state).toBe("failed")
  })

  test("a conflicting entry wins over the server state", () => {
    const status = buildStatus(facts({ source: { type: "conflict", command: "a local command", expected: "/opt/browse mcp" } }))
    expect(status.state).toBe("conflict")
    expect(status.nextStep).toContain("Every tool of that server is denied")
  })

  test("connected carries the relay and extension truth, and the counts", () => {
    const status = buildStatus(
      facts({
        server: { status: "connected" },
        tools: ["status", "execute", "shiny_new_tool"],
        relay: { running: true, version: "0.0.14", stale: false },
        extension: { connected: true, version: "0.0.14", pairingState: "paired", compatible: true, nextStep: null },
      }),
    )
    expect(status.state).toBe("connected")
    expect(status.tools).toBe(3)
    expect(status.unknownCount).toBe(1)
    expect(status.unknownTools).toEqual(["shiny_new_tool"])
    expect(status.access).toEqual({ run: 18, ask: 0, off: 0 })
    expect(status.nextStep).toContain("does not classify")
  })

  test("an unpaired extension is the next step, and the relay being down comes first", () => {
    const unpaired = buildStatus(facts({ server: { status: "connected" }, tools: ["status"], relay: { running: true, version: "0.0.14", stale: false }, extension: { connected: false, version: null, pairingState: "unpaired", compatible: null, nextStep: null } }))
    expect(unpaired.nextStep).toContain("Pair the browse extension")
    const stopped = buildStatus(facts({ server: { status: "connected" }, tools: ["status"], relay: { running: false, version: null, stale: false } }))
    expect(stopped.nextStep).toContain("relay is not running")
  })

  test("a user's own untested binary is named, not silently accepted", () => {
    const status = buildStatus(
      facts({
        server: { status: "connected" },
        tools: ["status"],
        binary: { path: "/opt/own-browse", version: "0.0.13", source: "option", verified: false, tested: false, supported: true },
        probe: { version: "0.0.13", tested: false },
        relay: { running: true, version: "0.0.13", stale: false },
        extension: { connected: true, version: "0.0.13", pairingState: "paired", compatible: true, nextStep: null },
      }),
    )
    expect(status.nextStep).toContain("not the pinned 0.0.15")
    expect(status.binary.tested).toBe(false)
  })

  test("the scoped profile's counts, and a drifted scope", () => {
    const status = buildStatus(facts({ rules: { access: "all", scoped: true, readOnly: true }, server: { status: "connected" }, tools: ["status"], relay: { running: true, version: null, stale: false }, extension: { connected: true, version: null, pairingState: "paired", compatible: true, nextStep: null }, scope: { session: "opencode", readOnly: true, allowedOrigins: ["github.com"], matches: false } }))
    expect(status.access).toEqual({ run: 13, ask: 0, off: 5 })
    expect(status.nextStep).toContain("re-apply the configured scope")
  })

  test("a host outside the range and no server is host untested", () => {
    const status = buildStatus(facts({ host: { version: "2.1.0", range: ">=2.2.3 <2.3.0", tested: false } }))
    expect(status.state).toBe("host_untested")
    expect(status.nextStep).toContain("allowUntestedHost")
  })
})

describe("review findings", () => {
  test("DR-4: a bad option or host is a status, with its own next step", () => {
    const options = buildStatus(facts({ fatal: "OPTIONS_INVALID: Unknown option \"nope\". Next step: Fix the plugin options in opencode.json." }))
    expect(options.state).toBe("failed")
    expect(options.nextStep).toContain("Fix the plugin options")
    const hostOutside = buildStatus(facts({ fatal: "HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2.1.0. Next step: Use OpenCode >=2.2.3 <2.3.0.", host: { version: "2.1.0", range: ">=2.2.3 <2.3.0", tested: false } }))
    expect(hostOutside.state).toBe("host_untested")
  })

  test("DR-5: a legacy server is the next step", () => {
    const status = buildStatus(facts({ server: { status: "connected" }, tools: ["status"], legacy: true }))
    expect(status.legacy).toBe(true)
    expect(status.nextStep).toContain('"opencode-browser" MCP server is still configured')
  })

  test("DR-17: a conflict denies every tool of the server holding the name", () => {
    const status = buildStatus(facts({ source: { type: "conflict", command: "a local command", expected: "/opt/browse mcp" }, tools: ["execute", "network"] }))
    expect(status.access).toEqual({ run: 0, ask: 0, off: 18 })
  })

  test("DR-21: a scope that cannot be read is not reported as matching", async () => {
    const { readStatus } = await import("../../src/status.js")
    const status = await readStatus(
      { mcp: { list: async () => ({ data: [{ name: "browse", status: { status: "connected" } }] }) }, agent: { list: async () => ({ data: [] }) }, tool: { list: async () => [] } } as never,
      { host, rules, mode: "real", binary, scope: { session: "opencode", readOnly: true, allowedOrigins: [], matches: false }, live: async () => ({ status: { relay: { running: false, version: null, stale: false }, extension: { connected: false, version: null, pairingState: null, protocolCompatible: null, nextStep: null }, sessions: [], autoUpdate: null, updateAvailable: null, relayError: null } }) },
    )
    expect(status.scope?.matches).toBe(false)
  })

  test("DR-15: a relay that reports an error is not read as merely stopped", async () => {
    const { readStatus } = await import("../../src/status.js")
    const status = await readStatus(
      { mcp: { list: async () => ({ data: [{ name: "browse", status: { status: "connected" } }] }) }, agent: { list: async () => ({ data: [] }) }, tool: { list: async () => [] } } as never,
      {
        host,
        rules,
        mode: "real",
        binary,
        live: async () => ({ status: { relay: { running: false, version: null, stale: false }, extension: { connected: false, version: null, pairingState: null, protocolCompatible: null, nextStep: null }, sessions: [], autoUpdate: null, updateAvailable: null, relayError: "the relay panicked" } }),
      },
    )
    expect(status.problems.some((problem) => problem.startsWith("RELAY_FAILED"))).toBe(true)
    expect(status.nextStep).toContain("Run /browse-doctor")
  })

  test("managed mode: not installed names the command and the size", () => {
    const status = buildStatus(
      facts({
        mode: "managed",
        server: { status: "connected" },
        tools: ["status"],
        managed: {
          mode: "managed",
          state: "not_installed",
          chromium: { path: null, version: null, source: null, verified: false },
          chromiumPin: { version: "157.0.8103.38", supported: true, bytes: 196_562_867 },
          extension: { version: "0.0.14", directory: null },
          profile: "/p",
          pid: null,
          headless: false,
          lastError: null,
        },
      }),
    )
    expect(status.nextStep).toContain("/browse-install-browser")
    expect(status.nextStep).toContain("197 MB")
  })

  test("managed mode: a running browser is a row, and its profile is separate", () => {
    const text = formatStatus(
      buildStatus(
        facts({
          mode: "managed",
          server: { status: "connected" },
          tools: ["status"],
          relay: { running: true, version: "0.0.14", stale: false },
          extension: { connected: true, version: "0.0.14", pairingState: "paired", compatible: true, nextStep: null },
          managed: {
            mode: "managed",
            state: "running",
            chromium: { path: "/c", version: "157.0.8103.38", source: "installed", verified: true },
            chromiumPin: { version: "157.0.8103.38", supported: true },
            extension: { version: "0.0.14", directory: "/e" },
            profile: "/p",
            pid: 42,
            headless: true,
            lastError: null,
          },
        }),
      ),
    )
    expect(text).toContain("- Mode: managed browser")
    expect(text).toContain("- Managed: running · pid 42 · headless · extension 0.0.14 · Chrome for Testing 157.0.8103.38 (verified; installed)")
  })
})

describe("formatStatus", () => {
  test("has the S9 rows, in order, with the one next step last", () => {
    const text = formatStatus(buildStatus(facts({ server: { status: "connected" }, tools: ["status"], relay: { running: true, version: "0.0.14", stale: false }, extension: { connected: true, version: "0.0.14", pairingState: "paired", compatible: true, nextStep: null } })))
    const labels = text.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(":")))
    expect(labels).toEqual(["Connection", "Mode", "Access", "Browser", "Relay", "Extension", "Recording", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(text).not.toContain("Account")
  })

  test("shows the access counts and the binary's provenance", () => {
    const text = formatStatus(buildStatus(facts({ server: { status: "connected" }, tools: ["status"] })))
    expect(text).toContain("18 run · 0 ask · 0 off")
    expect(text).toContain("browse 0.0.15 (verified at startup, pinned; the release)")
  })
})

describe("the status RPC", () => {
  test("registers browse.status and returns the model", async () => {
    const registered: unknown[] = []
    const rpc = { register: (definition: unknown) => { registered.push(definition); return Promise.resolve({ dispose: async () => undefined }) } }
    const stop = await registerStatusRpc(rpc as never, async () => buildStatus(facts({ server: { status: "connected" }, tools: ["status"] })))
    await stop.dispose()
    expect(registered).toHaveLength(1)
    expect(StatusRpc.id).toBe("browse")
    expect(Object.keys(StatusRpc.methods)).toEqual(["status"])
  })

  test("a failure is STATUS_UNAVAILABLE with one next step", async () => {
    let handler: ((input: unknown, context: { error: (type: string, message: string, data: unknown) => unknown }) => Promise<unknown>) | undefined
    const rpc = { register: (_definition: unknown, handlers: Record<string, typeof handler>) => { handler = handlers.status; return Promise.resolve({ dispose: async () => undefined }) } }
    const stop = await registerStatusRpc(rpc as never, async () => {
      throw new Error("boom")
    })
    const answer = await handler!({}, { error: (type, message, data) => ({ type, message, data }) })
    await stop.dispose()
    expect(answer).toEqual({ type: "unavailable", message: "STATUS_UNAVAILABLE: Could not read Browse's status (boom).", data: { nextStep: "Restart OpenCode, then run /browse-status again." } })
  })

  test("its rule set is the default one", () => {
    expect(defaultRules(rules)[0]).toEqual({ action: "browse_*", resource: "*", effect: "allow" })
  })
})
