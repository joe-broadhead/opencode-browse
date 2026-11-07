import { describe, expect, test } from "bun:test"
import { viewMessage } from "../../src/tui.js"
import { buildStatus } from "../../src/status.js"

const host = { version: "2.2.4", range: ">=2.2.3 <2.3.0", tested: true }
const binary = { path: "/opt/browse", version: "0.0.14", source: "package" as const, verified: true, tested: true, supported: true, pinned: true, platform: "darwin-arm64" }

describe("the dialog", () => {
  test("carries the status report without its heading, and the key hint", () => {
    const status = buildStatus({ host, rules: { scoped: false, readOnly: false }, binary, server: { status: "connected" }, tools: ["status"] })
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
