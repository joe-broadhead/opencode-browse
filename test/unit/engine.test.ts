import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseJsonOutput, parseStatus, parseVersion, platformKey, resolveBinary } from "../../src/engine.js"

describe("platform mapping", () => {
  test("names the four packages", () => {
    expect(platformKey("darwin", "arm64")).toBe("darwin-arm64")
    expect(platformKey("darwin", "x64")).toBe("darwin-x64")
    expect(platformKey("linux", "x64")).toBe("linux-x64-gnu")
    expect(platformKey("linux", "arm64")).toBe("linux-arm64-gnu")
    expect(platformKey("win32", "x64")).toBeUndefined()
    expect(platformKey("linux", "ia32")).toBeUndefined()
  })
})

describe("version", () => {
  test("reads a bare or prefixed version and ignores a suffix", () => {
    expect(parseVersion("0.0.14")).toBe("0.0.14")
    expect(parseVersion("browse 0.0.14\n")).toBe("0.0.14")
    expect(parseVersion("0.0.15-dev.3")).toBe("0.0.15")
    expect(parseVersion("no version")).toBeUndefined()
  })
})

describe("JSON from the CLI", () => {
  test("parses pretty output, a single line, and nothing", () => {
    expect(parseJsonOutput('{\n  "a": 1\n}\n')).toEqual({ a: 1 })
    expect(parseJsonOutput('{"a":1}\n')).toEqual({ a: 1 })
    expect(parseJsonOutput("")).toBeUndefined()
    expect(parseJsonOutput("not json")).toBeUndefined()
  })

  test("parses the status envelope defensively", () => {
    expect(
      parseStatus({
        relay: { running: true, version: "0.0.14", stale: false },
        extension: { connected: true, pairingState: "paired", protocolCompatible: true },
        sessions: [{ id: "opencode", readOnly: true, allowedOrigins: ["github.com"] }],
        update: { latest: "0.0.15" },
      }),
    ).toEqual({
      relay: { running: true, version: "0.0.14", stale: false },
      extension: { connected: true, version: null, pairingState: "paired", protocolCompatible: true, nextStep: null },
      sessions: [{ id: "opencode", readOnly: true, allowedOrigins: ["github.com"] }],
      autoUpdate: null,
      updateAvailable: "0.0.15",
      relayError: null,
    })
    expect(parseStatus({ relay: "nope", extension: null, sessions: [1, null, {}] })).toEqual({
      relay: { running: false, version: null, stale: false },
      extension: { connected: false, version: null, pairingState: null, protocolCompatible: null, nextStep: null },
      sessions: [],
      autoUpdate: null,
      updateAvailable: null,
      relayError: null,
    })
    expect(parseStatus("x")).toBeUndefined()
    // DR-15: autoUpdate is an object, and a relay error is carried.
    const object = parseStatus({ relay: { running: true }, extension: null, sessions: [], autoUpdate: { mode: "notify", effective: "notify" } })
    expect(object?.autoUpdate).toBe("notify")
    const broken = parseStatus({ relay: { running: false, error: "the relay panicked" }, extension: null, sessions: [] })
    expect(broken?.relayError).toBe("the relay panicked")
    expect(parseStatus(null)).toBeUndefined()
  })
})

describe("resolution", () => {
  const dir = mkdtempSync(join(tmpdir(), "browse-engine-"))
  const make = (binary: string, recorded?: string) => {
    const packageDir = join(dir, "node_modules", "@joe-broadhead", `opencode-browse-bin-${process.platform === "darwin" ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64") : process.arch === "arm64" ? "linux-arm64-gnu" : "linux-x64-gnu"}`)
    rmSync(join(dir, "node_modules"), { recursive: true, force: true })
    mkdirSync(join(packageDir, "bin"), { recursive: true })
    mkdirSync(join(packageDir, "manifest"), { recursive: true })
    writeFileSync(join(packageDir, "bin", "browse"), binary)
    writeFileSync(
      join(packageDir, "manifest", "browse.json"),
      JSON.stringify({ version: "0.0.15", sha256: recorded ?? createHash("sha256").update(binary).digest("hex"), bytes: binary.length, target: "test", upstream: "https://github.com/anomalyco/browse", licence: "MIT" }),
    )
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "fake", version: "0.0.0" }))
    return packageDir
  }

  test("finds the platform package and verifies its digest", () => {
    make("binary")
    const info = resolveBinary({ packageRoot: dir })
    expect(info).toMatchObject({ source: "package", version: "0.0.15", verified: true, pinned: true, tested: true })
    // The package is named by the platform key (linux-arm64-gnu), not by the label the info carries (linux-arm64).
    expect(info.path).toBe(join(dir, "node_modules", "@joe-broadhead", `opencode-browse-bin-${platformKey(process.platform, process.arch)}`, "bin", "browse"))
  })

  test("refuses a packaged binary whose digest differs, before anything runs", () => {
    make("binary", "0".repeat(64))
    expect(() => resolveBinary({ packageRoot: dir })).toThrow(/^BINARY_UNVERIFIED: /)
    expect(resolveBinary({ packageRoot: dir, verify: false })).toMatchObject({ verified: false })
  })

  test("a missing packaged binary is BINARY_MISSING unless an option or the seam names one", () => {
    rmSync(join(dir, "node_modules"), { recursive: true, force: true })
    expect(() => resolveBinary({ packageRoot: dir })).toThrow(/^BINARY_MISSING: /)
    const own = join(dir, "own-browse")
    writeFileSync(own, "x")
    expect(resolveBinary({ packageRoot: dir, optionPath: own })).toMatchObject({ source: "option", verified: false, tested: false })
    expect(() => resolveBinary({ packageRoot: dir, optionPath: join(dir, "nope") })).toThrow(/^BINARY_MISSING: /)
    expect(resolveBinary({ packageRoot: dir, env: { OPENCODE_BROWSE_TEST: "1", OPENCODE_BROWSE_BIN: own } })).toMatchObject({ source: "environment" })
    expect(() => resolveBinary({ packageRoot: dir, env: { OPENCODE_BROWSE_BIN: own } })).toThrow(/^BINARY_MISSING: /)
  })

  test("an unsupported platform says so", () => {
    expect(() => resolveBinary({ platform: "win32", arch: "x64" })).toThrow(/^UNSUPPORTED_PLATFORM: /)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))
})
