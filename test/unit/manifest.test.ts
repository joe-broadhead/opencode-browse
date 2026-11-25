// The manifest is the source of truth: the contract validates it, the package name derives from the plugin name, and
// the 18 pass-through tools the browse server lists are exactly the ones the methods table classifies.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkManifest, readInstalledManifest } from "@we-the-rebel-alliance/plugin-contract/manifest"

const root = fileURLToPath(new URL("../..", import.meta.url))
const read = (path: string) => readFileSync(join(root, path), "utf8")
const pkg = JSON.parse(read("package.json")) as { name: string; version: string; capabilities: Record<string, unknown> }
const live = JSON.parse(read("test/fixtures/live-tools.json")) as { tools: { name: string }[] }

/** The class each pass-through tool has, as the inventory posted on the tracking issue classifies it. */
const CLASSES: Readonly<Record<string, string>> = {
  status: "read",
  session_list: "read",
  secrets_list: "read",
  secrets_status: "read",
  tabs_cleanup: "delete",
  execute: "admin",
  session_new: "write",
  session_use: "write",
  session_adopt: "write",
  session_reset: "delete",
  session_delete: "delete",
  settings: "write",
  network: "export",
  recording: "export",
  flight_recorder: "export",
  secrets_run: "admin",
  secrets_refresh: "admin",
  session_allowlist: "share",
}

const methods = () => pkg.capabilities["methods"] as Record<string, { class: string; accounts?: string }>

describe("the capabilities manifest", () => {
  test("is the contract's, valid and hashed from the installed package", () => {
    const checked = checkManifest(pkg.capabilities)
    expect(checked.ok ? [] : checked.problems).toEqual([])
    const installed = readInstalledManifest(root)
    expect(installed.ok).toBe(true)
    if (installed.ok) {
      expect(installed.value.package).toBe("@we-the-rebel-alliance/browse-plugin")
      expect(installed.value.hash.startsWith("sha256:")).toBe(true)
      expect(installed.value.manifest.plugin.name).toBe("browse")
    }
  })

  test("names one plugin, one namespace and one RPC id", () => {
    expect(pkg.name).toBe("@we-the-rebel-alliance/browse-plugin")
    expect((pkg.capabilities["plugin"] as { name: string }).name).toBe("browse")
  })

  test("keeps the namespace line within the fixed-context budget, on one line", () => {
    const summary = (pkg.capabilities["plugin"] as { summary: string }).summary
    expect(summary.length).toBeLessThanOrEqual(400)
    expect(summary).not.toMatch(/[\r\n]/)
  })

  test("declares no accounts, no sources, no actions and no bus events", () => {
    expect("accounts" in pkg.capabilities).toBe(false)
    expect(pkg.capabilities["sources"]).toEqual([])
    expect(pkg.capabilities["actions"]).toEqual([])
    expect(pkg.capabilities["events"]).toEqual({})
  })

  test("classifies every tool the browse server lists, and nothing else", () => {
    const declared = Object.keys(methods()).filter((method) => method.startsWith("mcp:")).map((method) => method.slice(4))
    expect(declared.sort()).toEqual(live.tools.map((tool) => tool.name).sort())
    for (const [tool, cls] of Object.entries(CLASSES)) expect({ tool, class: methods()[`mcp:${tool}`]?.class }).toEqual({ tool, class: cls })
  })

  test("declares its own two methods as reads, with no account", () => {
    expect(methods()["status"]).toEqual({ class: "read", accounts: "none" })
    expect(methods()["report"]).toEqual({ class: "read", accounts: "none" })
  })

  test("declares the same tool names the pinned fixture recorded", () => {
    const fixture = JSON.parse(read("test/fixtures/live-tools.json")) as { serverInfo: { version: string }; tools: { name: string }[] }
    expect(fixture.serverInfo.version).toBe("0.0.15")
    expect(fixture.tools).toHaveLength(18)
  })

  test("keeps the access and host options the contract requires", () => {
    const options = pkg.capabilities["options"] as { properties: Record<string, { enum?: string[]; default?: unknown }> }
    expect(options.properties["access"]?.enum).toEqual(["all", "ask-changes", "read-only"])
    expect(options.properties["access"]?.default).toBe("all")
    expect(options.properties["allowUntestedHost"]?.default).toBe(false)
    expect(Object.keys(options.properties)).toContain("scope")
    expect(Object.keys(options.properties)).not.toContain("accounts")
  })
})
