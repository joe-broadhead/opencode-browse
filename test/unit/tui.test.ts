import { describe, expect, test } from "bun:test"
import { setupView, viewMessage } from "../../src/tui.js"
import { buildStatus } from "../../src/status.js"

const host = { version: "2.2.4", range: ">=2.2.3 <2.3.0", tested: true }
const binary = { path: "/opt/browse", version: "0.0.14", source: "package" as const, verified: true, tested: true, supported: true, pinned: true, platform: "darwin-arm64" }

describe("the dialog's open and close path", () => {
  test("opens one alert per open, stops its listeners on close, and `r` does nothing while closed", async () => {
    let listeners = 0
    let alerts = 0
    let resolveAlert: (() => void) | undefined
    const commands: { id: string; bind?: string; run: () => void; enabled?: () => boolean }[] = []
    const context = {
      location: undefined,
      client: { rpc: () => ({ status: async () => buildStatus({ host, rules: { access: "all" as const, scoped: false, readOnly: false }, mode: "real", binary, server: { status: "connected" }, tools: ["status"] }) }) },
      data: {
        on: (_event: string, _handler: () => void) => {
          listeners += 1
          return () => {
            listeners -= 1
          }
        },
      },
      ui: {
        dialog: {
          alert: () => {
            alerts += 1
            return new Promise<void>((resolve) => {
              resolveAlert = resolve
            })
          },
          set: () => undefined,
          clear: () => undefined,
        },
      },
      keymap: { layer: (build: () => { commands: typeof commands }) => void commands.push(...build().commands) },
    }
    const dispose = setupView(context as never)
    const open = commands.find((command) => command.id === "browse.status")!
    const refresh = commands.find((command) => command.id === "browse.status.refresh")!
    expect(alerts).toBe(0)
    refresh.run()
    await Bun.sleep(20)
    expect(alerts).toBe(0)
    open.run()
    await Bun.sleep(20)
    expect(alerts).toBe(1)
    expect(listeners).toBeGreaterThan(0)
    resolveAlert!()
    await Bun.sleep(20)
    expect(listeners).toBe(0)
    // A refresh while closed does nothing.
    refresh.run()
    await Bun.sleep(20)
    expect(alerts).toBe(1)
    dispose()
    expect(listeners).toBe(0)
  })
})

describe("the dialog", () => {
  test("carries the status report without its heading, and the key hint", () => {
    const status = buildStatus({ host, rules: { access: "all" as const, scoped: false, readOnly: false }, mode: "real", binary, server: { status: "connected" }, tools: ["status"] })
    const message = viewMessage({ status })
    expect(message).toStartWith("- Connection: connected")
    expect(message).not.toContain("Browse status")
    expect(message.endsWith("r refresh · esc close")).toBe(true)
  })

  test("a failed server part says so, with one next step", () => {
    const message = viewMessage({ error: { type: "unavailable", message: "STATUS_UNAVAILABLE: Could not read Browse's status.", data: { nextStep: "Restart OpenCode." } } })
    expect(message).toContain("STATUS_UNAVAILABLE: Could not read Browse's status. Next step: Restart OpenCode.")
    expect(message.endsWith("r refresh · esc close")).toBe(true)
  })

  test("an absent server part names the plugin", () => {
    const message = viewMessage({ error: { type: "rpc.unavailable", message: "no server" } })
    expect(message).toContain("The Browse plugin is not running on this OpenCode server.")
  })
})
