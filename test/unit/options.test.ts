import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/options.js"

describe("parseOptions", () => {
  test("defaults: the pinned binary, verify, no scope", () => {
    expect(parseOptions(undefined)).toEqual({ verifyBinary: true, allowUntestedHost: false })
    expect(parseOptions(null)).toEqual({ verifyBinary: true, allowUntestedHost: false })
    expect(parseOptions({})).toEqual({ verifyBinary: true, allowUntestedHost: false })
  })

  test("a path, and the two booleans", () => {
    expect(parseOptions({ path: " /opt/browse ", verifyBinary: false, allowUntestedHost: true })).toEqual({
      path: "/opt/browse",
      verifyBinary: false,
      allowUntestedHost: true,
    })
  })

  test("a scope, normalised", () => {
    expect(parseOptions({ scope: { allowedOrigins: [" GitHub.com ", "*.example.com"] } })).toEqual({
      verifyBinary: true,
      allowUntestedHost: false,
      scope: { session: "opencode", allowedOrigins: ["github.com", "*.example.com"], readOnly: false },
    })
    expect(parseOptions({ scope: { session: "work", readOnly: true } })).toMatchObject({ scope: { session: "work", readOnly: true, allowedOrigins: [] } })
  })

  test("refuses unknown keys, wrong types and unsafe names", () => {
    for (const raw of [
      { nope: 1 },
      { path: "" },
      { path: 3 },
      { verifyBinary: "yes" },
      { scope: [] },
      { scope: { session: "Bad Name" } },
      { scope: { session: "../x" } },
      { scope: { allowedOrigins: "github.com" } },
      { scope: { allowedOrigins: [""] } },
      { scope: { allowedOrigins: ["https://github.com/path"] } },
      { scope: { allowedOrigins: ["a b"] } },
      { scope: { readOnly: "true" } },
      { scope: { other: 1 } },
      { scope: { allowedOrigins: Array.from({ length: 101 }, (_, index) => `h${index}.example.com`) } },
    ]) {
      expect(() => parseOptions(raw), JSON.stringify(raw)).toThrow(/^OPTIONS_INVALID: /)
    }
  })

  test("the error names the next step exactly once", () => {
    try {
      parseOptions({ scope: { allowedOrigins: ["*"] } })
    } catch (error) {
      expect((error as Error).message).toContain("Next step: Fix the plugin options in opencode.json")
      expect((error as Error).message.match(/Next step:/g)).toHaveLength(1)
    }
  })
})
