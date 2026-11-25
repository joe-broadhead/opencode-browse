// One code table, and a README that lists it. Every `CODE: message` this plugin writes is in the table (the contract's
// own codes excepted), and every code in the table is documented for the person who meets it.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PLUGIN_CODES } from "../../src/constants.js"

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

/** The contract's codes, which a plugin uses but does not declare. */
const CONTRACT = new Set([
  "NEEDS_SIGN_IN",
  "SCOPE_MISSING",
  "ACCOUNT_REQUIRED",
  "ACCOUNT_UNKNOWN",
  "ACCOUNT_MISMATCH",
  "CURSOR_INVALID",
  "CURSOR_EXPIRED",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "SOURCE_DISABLED",
  "TOO_LARGE",
  "INPUT_INVALID",
  "SOURCE_UNKNOWN",
  "SCHEMA_VIOLATION",
  "PERMISSION_DENIED",
  "PLAN_INVALID",
  "PLAN_USED",
  "GRANT_INVALID",
  "HOST_UNTESTED",
  "OPTIONS_INVALID",
  "UNAVAILABLE",
])

// `src/provider/native.ts` is the native release-binary installer: its NATIVE_* codes are mapped to plugin codes before
// any tool reports them, so they are not this plugin's codes.
const source = walk("src").filter((file) => file !== "src/provider/native.ts")
const raised = new Set(
  source.flatMap((file) => [...read(file).matchAll(/(?:browseError|errorText)\(\s*"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)].map((match) => match[1]!).filter((code) => !CONTRACT.has(code))),
)
/** A `"CODE: …"` string written by hand, outside the two helpers. */
const literal = new Set(
  source.flatMap((file) => [...read(file).matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+): /g)].map((match) => match[1]!).filter((code) => !CONTRACT.has(code))),
)

describe("the code table", () => {
  test("is what the source raises, both ways", () => {
    expect([...raised].sort()).toEqual([...PLUGIN_CODES].filter((code) => raised.has(code)).sort())
    for (const code of raised) expect(PLUGIN_CODES as readonly string[]).toContain(code)
    for (const code of literal) expect([...(PLUGIN_CODES as readonly string[]), ...CONTRACT]).toContain(code)
  })

  test("names no duplicate", () => {
    expect(new Set(PLUGIN_CODES).size).toBe(PLUGIN_CODES.length)
  })

  test("is documented in the README", () => {
    const readme = read("README.md")
    for (const code of PLUGIN_CODES) expect({ code, listed: readme.includes(`\`${code}\``) }).toEqual({ code, listed: true })
  })
})
