import { describe, expect, test } from "bun:test"
import { buildStatus, formatStatus, registerStatusRpc, StatusRpc, type StatusFacts } from "../../src/status.js"
import { defaultRules } from "../../src/permissions.js"

const host = { version: "2.2.4", range: ">=2.2.3 <2.3.0", tested: true }
const rules = { scoped: false, readOnly: false }
const binary = { path: "/opt/browse", version: "0.0.14", source: "package" as const, verified: true, tested: true, supported: true }

const facts = (overrides: Partial<StatusFacts> = {}): StatusFacts => ({ host, rules, binary, probe: { version: "0.0.14", tested: true }, ...overrides })

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
    expect(status.nextStep).toContain("Remove that entry")
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
    expect(status.access).toEqual({ run: 8, ask: 10, off: 0 })
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
    expect(status.nextStep).toContain("not the pinned 0.0.14")
    expect(status.binary.tested).toBe(false)
  })

  test("the scoped profile's counts, and a drifted scope", () => {
    const status = buildStatus(facts({ rules: { scoped: true, readOnly: true }, server: { status: "connected" }, tools: ["status"], relay: { running: true, version: null, stale: false }, extension: { connected: true, version: null, pairingState: "paired", compatible: true, nextStep: null }, scope: { session: "opencode", readOnly: true, allowedOrigins: ["github.com"], matches: false } }))
    expect(status.access).toEqual({ run: 9, ask: 4, off: 5 })
    expect(status.nextStep).toContain("re-apply the configured scope")
  })

  test("a host outside the range and no server is host untested", () => {
    const status = buildStatus(facts({ host: { version: "2.1.0", range: ">=2.2.3 <2.3.0", tested: false } }))
    expect(status.state).toBe("host_untested")
    expect(status.nextStep).toContain("allowUntestedHost")
  })
})

describe("formatStatus", () => {
  test("has the S9 rows, in order, with the one next step last", () => {
    const text = formatStatus(buildStatus(facts({ server: { status: "connected" }, tools: ["status"], relay: { running: true, version: "0.0.14", stale: false }, extension: { connected: true, version: "0.0.14", pairingState: "paired", compatible: true, nextStep: null } })))
    const labels = text.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(":")))
    expect(labels).toEqual(["Connection", "Access", "Browser", "Relay", "Extension", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(text).not.toContain("Account")
  })

  test("shows the access counts and the binary's provenance", () => {
    const text = formatStatus(buildStatus(facts({ server: { status: "connected" }, tools: ["status"] })))
    expect(text).toContain("8 run · 10 ask · 0 off")
    expect(text).toContain("browse 0.0.14 (verified, pinned; the platform package)")
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
    expect(defaultRules(rules)[0].effect).toBe("deny")
  })
})
