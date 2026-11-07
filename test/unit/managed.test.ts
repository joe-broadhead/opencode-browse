import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { executableIn, installRoot, installedChromium, managedPlatform, parseChromiumVersion, readPin, resolveChromium } from "../../src/managed/chromium.js"
import { clearPairingCode, extensionIdOf, extensionVersion, prepareExtension, readExtensionPin, UNPACKED_EXTENSION_ID, verifyExtension, writePairingCode } from "../../src/managed/extension.js"
import { extensionDir } from "../../src/managed/paths.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const work = mkdtempSync(join(tmpdir(), "browse-managed-"))
const saved = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME }

beforeAll(() => {
  process.env.XDG_DATA_HOME = join(work, "data")
  process.env.XDG_CACHE_HOME = join(work, "cache")
})

afterAll(() => {
  if (saved.data === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = saved.data
  if (saved.cache === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = saved.cache
  rmSync(work, { recursive: true, force: true })
})

describe("the Chromium pin", () => {
  test("names the four platforms and records a digest and a size for each", () => {
    const pin = readPin(join(root, "manifest"))
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    for (const key of ["darwin-arm64", "darwin-x64", "linux-x64-gnu", "linux-arm64-gnu"]) {
      expect(pin.platforms[key]?.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(pin.platforms[key]?.bytes).toBeGreaterThan(1_000_000)
      expect(pin.platforms[key]?.cftPlatform).toBe(key === "darwin-arm64" ? "mac-arm64" : key === "darwin-x64" ? "mac-x64" : key === "linux-x64-gnu" ? "linux64" : "linux-arm64")
    }
  })

  test("the executable lives where each platform's zip puts it", () => {
    expect(executableIn("/c", "mac-arm64")).toBe(join("/c", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"))
    expect(executableIn("/c", "linux64")).toBe(join("/c", "chrome-linux64", "chrome"))
  })

  test("reads a version and refuses branded Chrome", () => {
    expect(parseChromiumVersion("Google Chrome for Testing 157.0.8103.38")).toEqual({ version: "157.0.8103.38", branded: false })
    expect(parseChromiumVersion("Chromium 141.0.7390.54")).toEqual({ version: "141.0.7390.54", branded: false })
    expect(parseChromiumVersion("Google Chrome 157.0.8103.38")).toEqual({ version: "157.0.8103.38", branded: true })
    expect(parseChromiumVersion("not a browser")).toBeUndefined()
  })

  test("verifies an installed browser and refuses one that changed", () => {
    const platform = managedPlatform()
    if (platform === undefined) return
    const pin = readPin(join(root, "manifest"))
    const dir = installRoot(pin.version)
    const executable = join(dir, "chrome")
    mkdirSync(dir, { recursive: true })
    writeFileSync(executable, "fake chromium binary")
    const digest = createHash("sha256").update(readFileSync(executable)).digest("hex")
    writeFileSync(join(dir, "install.json"), JSON.stringify({ version: pin.version, executable, sha256: digest, bytes: 20, installedAt: new Date().toISOString() }))
    expect(installedChromium(pin, platform)).toMatchObject({ path: executable, verified: true, source: "installed" })
    writeFileSync(executable, "changed")
    expect(() => installedChromium(pin, platform)).toThrow(/^CHROMIUM_UNVERIFIED: /)
  })

  test("an explicit Chromium is probed, and branded Chrome is refused", async () => {
    const good = join(work, "chromium")
    writeFileSync(good, '#!/bin/sh\necho "Google Chrome for Testing 157.0.8103.38"\n')
    chmodSync(good, 0o755)
    expect(await resolveChromium(join(root, "manifest"), { chromiumPath: good })).toMatchObject({ source: "option", version: "157.0.8103.38", verified: false })
    const branded = join(work, "chrome")
    writeFileSync(branded, '#!/bin/sh\necho "Google Chrome 157.0.8103.38"\n')
    chmodSync(branded, 0o755)
    await expect(resolveChromium(join(root, "manifest"), { chromiumPath: branded })).rejects.toThrow(/^CHROMIUM_BRANDED: /)
  })
})

describe("the pinned extension", () => {
  const pin = readExtensionPin(join(root, "manifest"))

  test("is 0.0.14, and every shipped file matches its digest", () => {
    expect(pin.version).toBe("0.0.14")
    expect(pin.files.length).toBeGreaterThan(10)
    expect(verifyExtension(join(root, "managed-extension"), pin)).toBeUndefined()
    expect(extensionVersion(join(root, "managed-extension"))).toBe("0.0.14")
  })

  test("carries the key the relay accepts, so its origin matches", () => {
    const manifest = JSON.parse(readFileSync(join(root, "managed-extension", "manifest.json"), "utf8"))
    expect(extensionIdOf(manifest.key)).toBe(UNPACKED_EXTENSION_ID)
  })

  test("a changed file is refused", () => {
    const copy = join(work, "extension-tamper")
    cpSync(join(root, "managed-extension"), copy, { recursive: true })
    writeFileSync(join(copy, "manifest.json"), "{}")
    expect(verifyExtension(copy, pin)).toContain("manifest.json")
  })

  test("preparing it copies, patches the relay port, and writes a one-time code owner-only", () => {
    const previous = process.env.OPENCODE_BROWSER_PORT
    process.env.OPENCODE_BROWSER_PORT = "23456"
    try {
      const directory = prepareExtension(root, pin)
      expect(existsSync(join(directory, "manifest.json"))).toBe(true)
      const background = readFileSync(join(directory, "background.js"), "utf8")
      expect(background).toContain("23456")
      expect(background).not.toBe(readFileSync(join(root, "managed-extension", "background.js"), "utf8"))
      writePairingCode(directory, "ABCD-EFGH")
      const file = join(directory, "relay-pairing.json")
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ code: "ABCD-EFGH" })
      expect(readFileSync(file, "utf8")).not.toContain("\n\n")
      clearPairingCode(directory)
      expect(existsSync(file)).toBe(false)
      expect(directory).toBe(extensionDir())
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_BROWSER_PORT
      else process.env.OPENCODE_BROWSER_PORT = previous
    }
  })
})
