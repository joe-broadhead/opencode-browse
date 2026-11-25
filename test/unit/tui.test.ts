// The status dialog: it reads the `report` method over the contract's one RPC id, prints the report without its
// heading, and stops its listeners when the dialog closes.
import { describe, expect, test } from "bun:test"
import { hostOf } from "../../src/report.js"
import { buildReport } from "../../src/report-build.js"
import { manifest } from "../../src/manifest.js"
import { setupView, viewMessage } from "../../src/tui.js"

const host = hostOf(manifest, "2.4.1")
const report = buildReport(manifest, {
  host,
  level: "all",
  mode: "real",
  binary: { path: "/opt/browse", version: "0.0.15", source: "package", verified: true, tested: true, supported: true },
  server: { status: "connected" },
  relay: { running: true, version: "0.0.15", stale: false },
  extension: { connected: true, version: "0.0.15", pairingState: "paired", compatible: true, nextStep: null },
  tools: ["status"],
  unguardedAgents: [],
})

describe("viewMessage", () => {
  test("shows the report without its heading, and the keys", () => {
    const text = viewMessage({ status: report })
    expect(text.startsWith("- Connection: connected")).toBe(true)
    expect(text).not.toContain("Browse status")
    expect(text.endsWith("r refresh · esc close")).toBe(true)
  })

  test("a running server with no answer is a status refusal with a next step", () => {
    const text = viewMessage({ error: { type: "rpc.unavailable", message: "no server part" } })
    expect(text).toContain("STATUS_UNAVAILABLE: The Browse plugin is not running on this OpenCode server. Next step:")
  })
})

describe("the dialog's open and close path", () => {
  test("opens one alert, reads report, and stops its listeners when the dialog closes", async () => {
    let listeners = 0
    let alerts = 0
    let resolveAlert: (() => void) | undefined
    const commands: { id: string; run: () => void }[] = []
    const received: { method?: string } = {}
    const context = {
      location: { directory: "/work" },
      client: {
        rpc: (definition: { id: string; methods: Record<string, unknown> }) => {
          received.method = `${definition.id}.${Object.keys(definition.methods)[0]}`
          return { report: async () => report }
        },
      },
      data: {
        on: () => {
          listeners += 1
          return () => {
            listeners -= 1
          }
        },
      },
      ui: { dialog: { alert: () => new Promise<void>((resolve) => (resolveAlert = resolve)), set: () => undefined, clear: () => undefined } },
      keymap: { layer: (build: () => { commands: { id: string; run: () => void }[] }) => void commands.push(...build().commands) },
    }
    const close = setupView(context as never)
    const open = commands.find((command) => command.id === "browse.status")!
    open.run()
    await Bun.sleep(10)
    expect(alerts).toBe(0)
    expect(received.method).toBe("browse.report")
    expect(listeners).toBeGreaterThan(0)
    resolveAlert?.()
    await Bun.sleep(10)
    expect(listeners).toBe(0)
    close()
  })
})
