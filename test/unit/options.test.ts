// The plugin options: every option is optional, the defaults are narrow, and a bad value becomes a status problem
// instead of throwing the plugin away.
import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/options.js"

const optionsOf = (raw: unknown) => {
  const parsed = parseOptions(raw)
  if (!parsed.ok) throw new Error(parsed.problem)
  return parsed.options
}

describe("the defaults", () => {
  test("are the real browser, headed, verified, untested-host off and access all", () => {
    expect(optionsOf(undefined)).toEqual({ browser: "real", headless: false, verifyBinary: true, allowUntestedHost: false, access: "all" })
    expect(optionsOf(null)).toEqual(optionsOf(undefined))
    expect(optionsOf({})).toEqual(optionsOf(undefined))
  })
})

describe("the plugin's own options", () => {
  test("reads a binary path, managed mode and a chromium path", () => {
    expect(optionsOf({ path: " /opt/browse ", browser: "managed", chromiumPath: "/opt/chromium", headless: true, verifyBinary: false })).toMatchObject({
      path: "/opt/browse",
      browser: "managed",
      chromiumPath: "/opt/chromium",
      headless: true,
      verifyBinary: false,
    })
  })

  test("reads a scope with a session, an allowlist and read-only", () => {
    expect(optionsOf({ scope: { session: "task-1", allowedOrigins: ["GitHub.com", "https://app.example.com"], readOnly: true } })).toMatchObject({
      scope: { session: "task-1", allowedOrigins: ["github.com", "https://app.example.com"], readOnly: true },
    })
    expect(optionsOf({ scope: {} })).toMatchObject({ scope: { session: "opencode", allowedOrigins: [], readOnly: false } })
  })

  test("reads the three access levels", () => {
    for (const access of ["all", "ask-changes", "read-only"] as const) expect(optionsOf({ access }).access).toBe(access)
  })
})

describe("a bad option", () => {
  const problem = (raw: unknown) => {
    const parsed = parseOptions(raw)
    expect(parsed.ok).toBe(false)
    return parsed.ok ? "" : parsed.problem
  }

  test("is OPTIONS_INVALID with a next step, never a throw", () => {
    for (const raw of [
      { nope: 1 },
      { browser: "brave" },
      { headless: "yes" },
      { verifyBinary: "no" },
      { allowUntestedHost: 1 },
      { access: "everything" },
      { path: "" },
      { scope: { session: "Bad Name" } },
      { scope: { allowedOrigins: [""] } },
      { scope: { readOnly: "no" } },
      { scope: { nope: true } },
      { scope: [] },
      "options",
    ]) {
      const text = problem(raw)
      expect(text.startsWith("OPTIONS_INVALID: ")).toBe(true)
      expect(text).toContain("Next step: ")
    }
  })

  test("names the accepted options for an unknown key", () => {
    expect(problem({ nope: 1 })).toContain('Unknown option "nope"')
  })
})
