import { describe, expect, test } from "bun:test"
import { renderDoctor } from "../../src/doctor.js"

const host = { version: "2.2.4", range: ">=2.2.3 <2.3.0", tested: true }
const binary = { path: "/opt/browse", version: "0.0.14", source: "package" as const, verified: true, tested: true, supported: true, pinned: true, platform: "darwin-arm64" }
const live = {
  status: {
    relay: { running: true, version: "0.0.14", stale: false },
    extension: { connected: true, version: "0.0.14", pairingState: "paired", protocolCompatible: true, nextStep: null },
    sessions: [],
    autoUpdate: null,
    updateAvailable: null,
    relayError: null,
  },
}

describe("renderDoctor", () => {
  test("says nothing to do when everything is right", () => {
    const text = renderDoctor({ binary, host, live, problems: [] })
    expect(text).toContain("- Binary: /opt/browse")
    expect(text).toContain("browse 0.0.14 · verified against its manifest · the pinned 0.0.14 · darwin-arm64")
    expect(text).toContain("- Relay: running · 0.0.14")
    expect(text).toContain("- Extension: connected · 0.0.14")
    expect(text.endsWith("- Next step: Nothing to do.")).toBe(true)
  })

  test("no binary is a reinstall", () => {
    const text = renderDoctor({ host, live: {}, problems: [] })
    expect(text).toContain("- Binary: none")
    expect(text).toContain("Next step: Reinstall the plugin")
  })

  test("an unverified or untested binary is named", () => {
    expect(renderDoctor({ binary: { ...binary, verified: false, source: "option" }, host, live, problems: [] })).toContain("your own path option")
    expect(renderDoctor({ binary: { ...binary, tested: false, version: "0.0.13" }, host, live, problems: [] })).toContain("not the pinned 0.0.14")
    // DR-19: the packaged binary with verifyBinary off is not called the user's own path.
    expect(renderDoctor({ binary: { ...binary, verified: false }, host, live, problems: [] })).not.toContain("remove \"path\"")
  })

  test("managed mode shows the browser, its verification and the install command", () => {
    const text = renderDoctor(
      {
        binary,
        host,
        live,
        problems: [],
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
      },
    )
    expect(text).toContain("- Mode: managed browser · not_installed")
    expect(text).toContain("pinned Chrome for Testing 157.0.8103.38")
    expect(text).toContain("/browse-install-browser")
    expect(text).toContain("Next step: Run /browse-install-browser")
  })

  test("a stopped relay, an unpaired extension and a scope are all shown", () => {
    const text = renderDoctor({
      binary,
      host,
      live: { status: { ...live.status, relay: { running: false, version: null, stale: false }, extension: { connected: false, version: null, pairingState: "unpaired", protocolCompatible: null, nextStep: "Run browse pair." }, relayError: null } },
      scope: { session: "opencode", readOnly: true, allowedOrigins: ["github.com", "*.example.com"] },
      scopeResult: { changed: true, action: "created session opencode" },
      problems: [],
    })
    expect(text).toContain("- Relay: stopped")
    expect(text).toContain("- Extension: not connected (unpaired)")
    expect(text).toContain("- Scope: opencode (read-only) · github.com, *.example.com · created session opencode")
    expect(text).toContain("Next step: Created session opencode.")
  })

  test("an unprepared scope asks for another run", () => {
    const text = renderDoctor({ binary, host, live, scope: { session: "opencode", readOnly: false, allowedOrigins: [] }, problems: [] })
    expect(text).toContain("not prepared")
    expect(text).toContain("Run /browse-doctor again")
  })

  test("the vendor's checks are summarised, never dumped", () => {
    const text = renderDoctor(
      { binary, host, live, problems: [] },
      {
        checks: [
          { label: "Relay reachable", status: "ok" },
          { label: "Extension protocol", status: "warn", message: "update the extension" },
          { label: "Session targets", status: "fail", message: "one unhealthy target" },
        ],
        recommendations: ["Reload the extension on the extensions page."],
      },
    )
    expect(text).toContain("✓ Relay reachable")
    expect(text).toContain("! Extension protocol: update the extension")
    expect(text).toContain("✗ Session targets: one unhealthy target")
    expect(text).toContain("Vendor next steps: Reload the extension")
  })

  test("a binary that cannot answer is reported, not guessed", () => {
    const text = renderDoctor({ binary, host, live: { reason: "the status command timed out" }, problems: [] })
    expect(text).toContain("- Relay: unknown (the status command timed out)")
    expect(text).toContain("Next step: Run `/opt/browse status` in a terminal")
  })

  test("a problem without a rule failure is shown, and a RULES_NOT_ADDED problem is left to status", () => {
    const shown = renderDoctor({ binary, host, live, problems: ["SKILLS_INVALID: The \"browse\" skill was not loaded."] })
    expect(shown).toContain('Problems: SKILLS_INVALID: The "browse" skill was not loaded.')
    const hidden = renderDoctor({ binary, host, live, problems: ["RULES_NOT_ADDED: Browse's default permission rules could not be added."] })
    expect(hidden).not.toContain("Problems:")
  })
})
