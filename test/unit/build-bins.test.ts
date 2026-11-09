// The platform packages' build rules: the mapping from this computer to a pinned build, the digest check that refuses a
// wrong binary, and the table of platforms agreeing with the pin, so a new target cannot be pinned without a package.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { currentPlatform, PLATFORMS, verified } from "../../scripts/build-bins.mjs"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))

describe("build-bins", () => {
  test("maps this computer to the pinned platform key, and refuses a platform the pin does not name", () => {
    expect(currentPlatform("darwin", "arm64")).toBe("darwin-arm64")
    expect(currentPlatform("darwin", "x64")).toBe("darwin-x64")
    expect(currentPlatform("linux", "x64")).toBe("linux-x64-gnu")
    expect(currentPlatform("linux", "arm64")).toBe("linux-arm64-gnu")
    expect(currentPlatform("win32", "x64")).toBeUndefined()
  })

  test("every pinned target has a platform package, and no platform is packaged without a pin", () => {
    expect(Object.keys(pin.targets).sort()).toEqual(Object.keys(PLATFORMS).sort())
  })

  test("a file is verified only at the pinned size and SHA-256", () => {
    const dir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-build-bins-")))
    try {
      const bytes = Buffer.from("pinned browse bytes")
      const path = join(dir, "browse")
      writeFileSync(path, bytes)
      const expected = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
      expect(verified(path, expected)).toBe(true)
      expect(verified(path, { ...expected, bytes: bytes.length + 1 })).toBe(false)
      expect(verified(path, { ...expected, sha256: "0".repeat(64) })).toBe(false)
      expect(verified(join(dir, "missing"), expected)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
