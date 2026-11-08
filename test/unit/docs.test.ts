import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { TESTED_HOSTS } from "../../src/constants.js"
import { TOOLS } from "../../src/browse-tools.js"
import { PLUGIN_CODES } from "../../src/constants.js"
import { defaultRules } from "../../src/permissions.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const read = (path: string) => readFileSync(join(root, path), "utf8")
/** Every file under a folder, relative to the repository. */
function files(folder: string): string[] {
  return readdirSync(join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`
    return entry.isDirectory() ? files(path) : [path]
  })
}
const README = read("README.md")
const CONFIG = read("docs/configuration.md")
const SCRIPTING = read("docs/scripting.md")
const JELLY = read("docs/jelly.md")
const SECURITY = read("SECURITY.md")

const CODES = PLUGIN_CODES

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

  test("has a row for every code the code raises, and the scripting refusals", () => {
    // The shared tools-RPC module raises its own codes (SESSION_UNKNOWN and the rest); docs/scripting.md lists them.
    const raised = [...new Set(files("src").filter((path) => path !== "src/host/tools-rpc.ts").flatMap((path) => [...read(path).matchAll(/\b(?:browseError|errorText|fail)\(\s*"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)].map((match) => match[1]!)))]
    expect(raised.length).toBeGreaterThan(10)
    for (const code of raised) expect({ code, row: README.includes(`| \`${code}\``) }).toEqual({ code, row: true })
    for (const code of raised) expect({ code, doc: CONFIG.includes(`| \`${code}\``) }).toEqual({ code, doc: true })
    for (const code of CODES) expect(README, code).toContain(code)
    for (const code of CODES) expect(CONFIG, code).toContain(code)
    // A code a JSON string carries (the binary entry prints one and exits) is still a code.
    expect(README).toContain("BINARY_UNVERIFIED")
    // The RPC's own refusals are in the scripting guide, which is where a script looks.
    for (const code of ["PERMISSION_DENIED", "SESSION_UNKNOWN", "SESSION_AGENT_REQUIRED", "TOOL_UNAVAILABLE", "CANCELLED", "UPSTREAM_ERROR"]) {
      expect({ code, listed: SCRIPTING.includes(`\`${code}\``) }).toEqual({ code, listed: true })
    }
  })

  test("prints the generated rules block in full for each access value, exactly as the code makes it", () => {
    const fence = "```"
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      const marker = new RegExp(`<!-- rules:${access} -->\\n${fence}json\\n(\\[[\\s\\S]*?\\])\\n${fence}\\n<!-- /rules:${access} -->`)
      const block = marker.exec(README)?.[1]
      expect({ access, found: block !== undefined }).toEqual({ access, found: true })
      expect({ access, rules: JSON.parse(block!) }).toEqual({ access, rules: defaultRules({ access, scoped: false, readOnly: false }).map((rule) => ({ ...rule })) })
    }
  })

  test("every \"tested on\" list in the docs is TESTED_HOSTS", () => {
    const expected = `${TESTED_HOSTS.slice(0, -1).join(", ")} and ${TESTED_HOSTS.at(-1)}`
    let found = 0
    for (const document of ["README.md", "AGENTS.md", "SECURITY.md", "docs/configuration.md", "CHANGELOG.md"]) {
      const text = read(document).replace(/\s+/g, " ")
      for (const phrase of ["tested on "]) {
        for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + 1)) {
          found += 1
          expect({ document, after: text.slice(at + phrase.length, at + phrase.length + expected.length) }).toEqual({ document, after: expected })
        }
      }
    }
    expect(found).toBeGreaterThan(2)
  })

  test("names every tool, says every tool is allowed by default, and names the three ways to restrict", () => {
    for (const tool of TOOLS) expect(README, tool.name).toContain(`browse_${tool.name}`)
    expect(README).toContain("**Every tool is allowed by default.**")
    for (const value of ["\"all\"", "\"ask-changes\"", "\"read-only\""]) expect(README).toContain(value)
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
  test("every scripting example is a body the RPC accepts, with the header and the envelope", () => {
    const examples = [...SCRIPTING.matchAll(/opencode api post \/api\/rpc\/browse\.tools\/(\w+)([^\n]*-d '(\{[\s\S]*?\})')/g)]
    expect(examples.length).toBeGreaterThan(1)
    for (const [, method, , body] of examples) {
      expect({ method, known: method === "describe" || TOOLS.some((tool) => tool.name === method) }).toEqual({ method, known: true })
      const envelope = JSON.parse(body!) as { input?: { sessionID?: string; input?: unknown } }
      expect({ method, keys: Object.keys(envelope) }).toEqual({ method, keys: ["input"] })
      expect(typeof envelope.input?.sessionID).toBe("string")
    }
    for (const [, call] of SCRIPTING.matchAll(/^opencode api post([^\n]*)/gm)) expect(call).toContain("x-opencode-directory:$PWD")
    // No example may point at a port: the RPC is served by OpenCode, not the relay.
    expect(SCRIPTING).not.toMatch(/127\.0\.0\.1:\d+/)
    expect(SCRIPTING).toContain("## The location")
    expect(SCRIPTING).toContain("A `browse` result comes back as `{ output?, text }`")
  })

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
