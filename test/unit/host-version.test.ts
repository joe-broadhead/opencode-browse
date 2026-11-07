import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { checkHost, isSupportedHost, isTestedHost } from "../../src/host-version.js"

describe("host guard", () => {
  test.each(["2.2.3", "2.2.4", "2.2.5", "2.2.6"])("calls %s tested", (version) => {
    expect(isTestedHost(version)).toBe(true)
    expect(checkHost(version, false)).toEqual({ version, range: SUPPORTED_HOST, tested: true })
  })

  test.each(["2.2.99", "2.2.10"])("starts on %s, inside the range, and calls it untested", (version) => {
    expect(isSupportedHost(version)).toBe(true)
    expect(isTestedHost(version)).toBe(false)
    expect(checkHost(version, false)).toEqual({ version, range: SUPPORTED_HOST, tested: false })
  })

  test.each(["2.2.2", "2.3.0", "2.9.0", "3.0.0", "1.9.9", "2.2.4-beta.1", "0.0.0-dev-1", "unknown", "v2.2.3", "2.2"])(
    "refuses %j with the code, the version and the override",
    (version) => {
      expect(isSupportedHost(version)).toBe(false)
      expect(isTestedHost(version)).toBe(false)
      expect(() => checkHost(version, false)).toThrow(
        `HOST_UNTESTED: This plugin supports OpenCode ${SUPPORTED_HOST}, found ${version}. Next step: Use OpenCode ${SUPPORTED_HOST}, or set the plugin option "allowUntestedHost": true to run anyway.`,
      )
    },
  )

  test("a host with no version is refused, and reported as null with the override", () => {
    expect(() => checkHost("", false)).toThrow("found no version.")
    expect(checkHost("", true)).toEqual({ version: null, range: SUPPORTED_HOST, tested: false })
  })

  test("runs outside the range with allowUntestedHost, untested", () => {
    expect(checkHost("2.3.0", true)).toEqual({ version: "2.3.0", range: SUPPORTED_HOST, tested: false })
  })

  test("the supported range is the package's opencode.host, and the tested releases lie inside it", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
    expect(pkg.opencode.host).toBe(SUPPORTED_HOST)
    expect(TESTED_HOSTS).toEqual(["2.2.3", "2.2.4", "2.2.5", "2.2.6"])
    for (const version of TESTED_HOSTS) expect(isSupportedHost(version)).toBe(true)
  })
})
