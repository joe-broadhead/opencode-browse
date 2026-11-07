// The guard every test and script that runs the pinned binary keeps: an isolated HOME and XDG dirs, and a port that is
// never browse's default 19988. A test relay on 19988 would collide with a user's own relay and extension.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { assertIsolatedBrowseEnv, assertNoRelayLeft, VENDOR_DEFAULT_PORT } from "../support/relays.js"

const saved = { HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, OPENCODE_BROWSER_PORT: process.env.OPENCODE_BROWSER_PORT }
const root = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-test-")))
const restore = () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
afterAll(() => {
  restore()
  rmSync(root, { recursive: true, force: true })
})

describe("the isolated-run guard", () => {
  test("refuses an unset port, the vendor's default port, and the real HOME", () => {
    process.env.HOME = join(root, "home")
    process.env.XDG_DATA_HOME = join(root, "home", ".local", "share")
    delete process.env.OPENCODE_BROWSER_PORT
    expect(() => assertIsolatedBrowseEnv()).toThrow(/OPENCODE_BROWSER_PORT/)
    process.env.OPENCODE_BROWSER_PORT = String(VENDOR_DEFAULT_PORT)
    expect(() => assertIsolatedBrowseEnv()).toThrow(/19988/)
    process.env.OPENCODE_BROWSER_PORT = "23456"
    process.env.HOME = saved.HOME ?? "/Users/someone"
    expect(() => assertIsolatedBrowseEnv()).toThrow(/isolated HOME/)
  })

  test("accepts a temp HOME inside /tmp and a free port", () => {
    process.env.HOME = root
    process.env.XDG_DATA_HOME = join(root, ".local", "share")
    process.env.OPENCODE_BROWSER_PORT = "23457"
    expect(() => assertIsolatedBrowseEnv()).not.toThrow()
  })

  test("reports no relay for a HOME that has none", () => {
    expect(() => assertNoRelayLeft(root)).not.toThrow()
  })
})
