// One typed code table, and two docs that must match it exactly. Every code raised, printed or described in src is in
// the table or comes from the shared tools RPC; the README and docs/configuration tables list exactly the plugin's
// codes, both ways; and a `"CODE: message"` string written by hand fails.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PLUGIN_CODES } from "../../src/constants.js"
import { NEXT_STEPS } from "../../src/host/tools-rpc.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name.endsWith(".ts")) out.push(path)
  }
  return out
}

const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/

/** Every SCREAMING_SNAKE string literal in src, wherever it is raised or described. */
// src/native/ is the shared release-binary installer: its NATIVE_* codes are mapped to these plugin codes in engine.ts before any
// tool reports them, so they are not this plugin's codes.
const literals = new Set(walk("src").filter((file) => !file.startsWith("src/native/")).flatMap((file) => [...read(file).matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)"/g)].map((m) => m[1]!)))

/** The shared tools RPC's own codes, which are not this plugin's to declare. */
const SHARED = new Set([...Object.keys(NEXT_STEPS), "ACCOUNT_UNKNOWN"])

/** Uppercase literals that are not error codes: environment names, methods, and format names. */
const PLAIN = new Set([
  "JSON", "MCP", "UUID", "UTC", "GET", "HEAD", "PUT", "PATCH", "DELETE", "POST",
  "ENOENT", "EACCES", "EEXIST", "ENOTDIR", "EISDIR", "EPERM", "ENOSPC", "EMFILE",
  "OPENCODE_BROWSER_PORT", "OPENCODE_BROWSER_HOME", "OPENCODE_BROWSER_MCP_DIRECT", "OPENCODE_BROWSER_AUTO_UPDATE",
  "OPENCODE_BROWSER_SESSION", "OPENCODE_BROWSE_BIN", "OPENCODE_BROWSE_TEST", "OPENCODE_BROWSER_UPDATE_CHECK",
  "OPENCODE_BROWSER_MANAGED_RELAY", "OPENCODE_BROWSER_FILE_ROOTS", "OPENCODE_BROWSER_EXTENSION_ORIGINS",
  "AI_OPENCODE_SESSION_ID", "HOME", "PATH", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
  "XDG_CACHE_HOME", "XDG_BIN_HOME", "SIGTERM", "SIGINT", "SIGHUP", "SIGKILL", "UTF_8",
])

/** The codes a Markdown error table lists: the backticked code in its first cell. */
function tableCodes(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1]?.trim() ?? "")
    .flatMap((cell) => [...cell.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)`/g)].map((code) => code[1]!))
}

const README = read("README.md")
const CONFIG = read("docs/configuration.md")
const README_TABLE = README.split("## Troubleshooting")[1]?.split("## Uninstall")[0] ?? ""
const CONFIG_TABLE = CONFIG.split("## Errors")[1]?.split("## Status")[0] ?? ""

describe("the code table", () => {
  test("covers every code src raises or prints", () => {
    const known = new Set<string>([...PLUGIN_CODES, ...SHARED])
    // NATIVE_* are the installer's own codes, which engine.ts maps to these plugin codes before any tool reports them.
    const unknown = [...literals].filter((value) => CODE.test(value) && !known.has(value) && !PLAIN.has(value) && !value.startsWith("NATIVE_"))
    expect(unknown).toEqual([])
  })

  test("has no code raised that the table lacks, and no table entry nothing raises", () => {
    const raised = new Set([...literals].filter((value) => PLUGIN_CODES.includes(value as never)))
    expect([...PLUGIN_CODES].filter((code) => !raised.has(code))).toEqual([])
  })

  test("the README and docs/configuration tables list exactly the plugin's codes", () => {
    expect(tableCodes(README_TABLE).sort()).toEqual([...PLUGIN_CODES].sort())
    expect(tableCodes(CONFIG_TABLE).sort()).toEqual([...PLUGIN_CODES].sort())
  })

  test("no hand-written `CODE: message` string in src", () => {
    const offenders = walk("src").flatMap((file) =>
      read(file)
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
        .flatMap((line) => [...line.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+): /g)].map((match) => `${file}: ${match[1]}`)),
    )
    expect(offenders).toEqual([])
  })

  test("the wrapper's two codes are in the table", () => {
    const codes = [...read("bin/mcp.mjs").matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+): /g)].map((match) => match[1]!)
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.filter((code) => !PLUGIN_CODES.includes(code as never))).toEqual([])
  })
})
