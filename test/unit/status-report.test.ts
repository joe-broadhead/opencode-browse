// The contract's `status` and browse's `report`: the short answer an app reads and the diagnostic answer the dialog
// reads. Both are handler calls, so the tests drive the real handler and the real contract builder.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { UnguardedAgentsResult } from "@we-the-rebel-alliance/plugin-contract/access"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { createHandlers } from "../../src/handlers/index.js"
import { manifest } from "../../src/manifest.js"
import { hostOf, type Report } from "../../src/report.js"
import { buildReport } from "../../src/report-build.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const fixture = JSON.parse(readFileSync(join(root, "fixtures", "conformance.json"), "utf8")) as { events: { status: unknown } }
const host = hostOf(manifest as Manifest, "2.4.1")

const BINARY_PROBLEM =
  'BINARY_MISSING: This copy of the plugin has no release manifest, so it names no browse binary. Next step: Reinstall the plugin from a release, or set "path" to a browse binary.'

/** The report the provider builds when there is no binary, which is this development checkout's state. */
function noBinary(agents: readonly string[], extra: readonly string[] = []): Report {
  return buildReport(manifest as Manifest, {
    host,
    level: "all",
    mode: "real",
    binary: { path: null, version: null, source: null, verified: false, tested: false, supported: false },
    binaryProblem: BINARY_PROBLEM,
    problems: [BINARY_PROBLEM, ...extra],
    unguardedAgents: agents,
  })
}

/** The report of a connected, paired real browser with nothing to do. */
function ready(agents: readonly string[] = []): Report {
  return buildReport(manifest as Manifest, {
    host,
    level: "all",
    mode: "real",
    binary: { path: "/opt/browse", version: "0.0.15", source: "package", verified: true, tested: true, supported: true },
    server: { status: "connected" },
    relay: { running: true, version: "0.0.15", stale: false },
    extension: { connected: true, version: "0.0.15", pairingState: "paired", compatible: true, nextStep: null },
    tools: ["status", "session_list"],
    unguardedAgents: agents,
  })
}

const call = (unguardedAgents: () => Promise<UnguardedAgentsResult>) => ({ unguardedAgents }) as never

describe("the status method", () => {
  const handlers = (report: (agents: readonly string[], extra?: readonly string[]) => Promise<Report>) => createHandlers({ manifest: manifest as Manifest, version: "0.0.0", hostVersion: "2.4.1", report })

  test("answers the contract's shape, and the fixture is what it answered", async () => {
    const status = await handlers(async (agents, extra) => noBinary(agents, extra)).status.run({}, call(async () => ({ ok: true, agents: [] })))
    expect(status).toEqual(fixture.events.status)
  })

  test("is ready with no next step when nothing is wrong, and lists no accounts", async () => {
    const status = (await handlers(async (agents) => ready(agents)).status.run({}, call(async () => ({ ok: true, agents: [] })))) as Record<string, unknown>
    expect(status).toMatchObject({ name: "browse", version: "0.0.0", state: "ready", accounts: [], unguardedAgents: [], nextStep: null })
    expect(status["host"]).toEqual({ version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
  })

  test("names the agents that lack the generated rules", async () => {
    const status = (await handlers(async (agents) => ready(agents)).status.run({}, call(async () => ({ ok: true, agents: ["build", "plan"] })))) as Record<string, unknown>
    expect(status["unguardedAgents"]).toEqual(["build", "plan"])
  })

  test("turns an unreadable agent list into an error, never an empty success", async () => {
    const withExtra = async (agents: readonly string[], extra: readonly string[] = []) => buildReport(manifest as Manifest, {
      host,
      level: "all",
      mode: "real",
      binary: { path: "/opt/browse", version: "0.0.15", source: "package", verified: true, tested: true, supported: true },
      server: { status: "connected" },
      relay: { running: true, version: "0.0.15", stale: false },
      extension: { connected: true, version: "0.0.15", pairingState: "paired", compatible: true, nextStep: null },
      problems: [...extra],
      unguardedAgents: agents,
    })
    const status = (await handlers(withExtra).status.run({}, call(async () => ({ ok: false, error: "the host refused" })))) as Record<string, unknown>
    expect(status["state"]).toBe("error")
    expect(status["unguardedAgents"]).toEqual([])
    expect(String(status["nextStep"])).toContain("UNAVAILABLE")
    expect(String(status["nextStep"]).length).toBeLessThanOrEqual(200)
  })
})

describe("the report method", () => {
  test("answers the diagnostic report, with the agents its own call read", async () => {
    const handlers = createHandlers({ manifest: manifest as Manifest, version: "0.0.0", hostVersion: "2.4.1", report: async (agents) => ready(agents) })
    const report = (await handlers.report.run({}, call(async () => ({ ok: true, agents: ["build"] })))) as Record<string, unknown>
    expect(report).toMatchObject({ version: "0.0.0", state: "connected", mode: "real", unguardedAgents: ["build"] })
    expect(report["access"]).toEqual({ run: 18, ask: 0, off: 0 })
  })
})
