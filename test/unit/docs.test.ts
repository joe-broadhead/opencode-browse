import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { TOOLS } from "../../src/browse-tools.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const read = (path: string) => readFileSync(join(root, path), "utf8")
const README = read("README.md")
const CONFIG = read("docs/configuration.md")
const SCRIPTING = read("docs/scripting.md")
const JELLY = read("docs/jelly.md")
const SECURITY = read("SECURITY.md")

const CODES = [
  "BINARY_MISSING",
  "BINARY_UNVERIFIED",
  "UNSUPPORTED_PLATFORM",
  "SERVER_CONFLICT",
  "SERVER_LEGACY",
  "SERVER_NOT_REGISTERED",
  "RULES_NOT_ADDED",
  "SCOPE_LOST",
  "SCOPE_UNREACHABLE",
  "STATUS_UNAVAILABLE",
  "RELAY_FAILED",
  "RELAY_NOT_OURS",
  "RELAY_STOP_FAILED",
  "DOCTOR_FAILED",
  "HOST_UNTESTED",
  "OPTIONS_INVALID",
  "SKILLS_INVALID",
  "CHROMIUM_MISSING",
  "CHROMIUM_UNSUPPORTED",
  "CHROMIUM_DOWNLOAD_FAILED",
  "CHROMIUM_EXTRACT_FAILED",
  "CHROMIUM_UNVERIFIED",
  "CHROMIUM_INVALID",
  "CHROMIUM_BRANDED",
  "EXTENSION_UNVERIFIED",
]

describe("the README", () => {
  test("follows the family order", () => {
    expect(README.startsWith("# Browse for OpenCode\n")).toBe(true)
    expect(README).toContain("**Unofficial; not affiliated with Anomaly or OpenCode.**")
    const order = ["## Requirements", "## Install", "## Use", "## Permissions", "## Configure", "## Organisation rollout", "## Troubleshooting", "## Uninstall"]
    const positions = order.map((heading) => README.indexOf(heading))
    for (const position of positions) expect(position).toBeGreaterThan(-1)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(README).toContain("opencode plugin add @joe-broadhead/opencode-browse")
    expect(README).toContain("opencode plugin remove @joe-broadhead/opencode-browse")
    expect(README).toContain("`/etc/opencode/opencode.json` on Linux and `/Library/Application Support/opencode/opencode.json` on")
  })

  test("has a row for every error code", () => {
    for (const code of CODES) expect(README, code).toContain(code)
    for (const code of CODES) expect(CONFIG, code).toContain(code)
  })

  test("names every tool and the counts", () => {
    for (const tool of TOOLS) expect(README, tool.name).toContain(`browse_${tool.name}`)
    expect(README).toContain("8 run, 10 ask")
    expect(README).toContain("The three captures run without asking, by default.")
    expect(README).not.toMatch(/owner('s)? (decision|ruling)/i)
    expect(README).toContain("Managed browser (optional)")
    expect(README).toContain("its logins are separate")
    expect(README).toContain("/browse-install-browser")
  })

  test("links to repository files absolutely and carries no pre-release text", () => {
    const links = [...README.matchAll(/\]\((https:\/\/github\.com\/joe-broadhead\/opencode-browse\/blob\/HEAD\/[^)]+)\)/g)]
    expect(links.length).toBeGreaterThan(4)
    for (const phrase of ["not published", "provisional", "private package", "work in progress"]) expect(README.toLowerCase()).not.toContain(phrase)
  })
})

describe("the docs", () => {
  test("scripting lists exactly the 18 methods with a class", () => {
    for (const tool of TOOLS) expect(SCRIPTING, tool.name).toContain(`\`${tool.name}\``)
    expect(SCRIPTING).toContain("Only `allow` runs")
    expect(SCRIPTING).toContain("The three captures run by default")
    expect(SCRIPTING).toContain("authenticated request and response")
    expect(SCRIPTING).toContain("browse.tools")
  })

  test("jelly says what a Jelly agent can and cannot do", () => {
    expect(JELLY).toContain("18 tools")
    expect(JELLY).toContain("cannot drive the browser at all unless the person allows `browse_execute`")
    expect(JELLY).toContain("jelly.signIns")
    expect(JELLY).toContain("opencode.vendor")
  })

  test("security states the same-user, sandbox and capture facts", () => {
    expect(SECURITY).toContain("Same-user processes are trusted")
    expect(SECURITY).toContain("`execute` is not a sandbox")
    expect(SECURITY).toContain("No telemetry")
    expect(SECURITY).toContain("## Supported versions")
    expect(SECURITY).toContain("## Reporting a vulnerability")
    expect(SECURITY).toContain("## Data handling")
    expect(SECURITY).toContain("## Permissions")
  })

  test("the changelog is the family's shape", () => {
    const changelog = read("CHANGELOG.md")
    expect(changelog.startsWith("# Changelog\n")).toBe(true)
    expect(changelog).toContain("## [0.0.0] - Unreleased")
    expect(changelog).toContain("### Added")
  })
})
