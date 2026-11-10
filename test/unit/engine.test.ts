import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseJsonOutput, parseStatus, parseVersion, platformKey, resolveBinary, verifyBinaryNow } from "../../src/engine.js"

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
  // A package root with the upstream pin and the release manifest, and a cache where the released binary goes.
  const roots: string[] = []
  const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex")
  const key = platformKey(process.platform, process.arch) ?? "darwin-arm64"
  const cachedPath = (cacheRoot: string) => join(cacheRoot, "native", "v0.0.0", "browse", key, "browse")
  function release(binary: string, options: { pinned?: string; manifest?: boolean } = {}) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "browse-engine-")))
    roots.push(root)
    const cacheRoot = join(root, "cache")
    mkdirSync(join(root, "manifest"), { recursive: true })
    writeFileSync(join(root, "manifest", "browse.json"), JSON.stringify({
      version: "0.0.15",
      upstream: "https://github.com/anomalyco/browse",
      licence: "MIT",
      targets: { [key]: { target: "test", sha256: options.pinned ?? sha(binary), bytes: Buffer.byteLength(binary) } },
    }))
    if (options.manifest !== false) {
      writeFileSync(join(root, "manifest", "native.json"), JSON.stringify({
        schema: 1,
        plugin: "opencode-browse",
        repository: "joe-broadhead/opencode-browse",
        tag: "v0.0.0",
        built: { commit: "0".repeat(40), run: 1, workflow: "native" },
        modules: {
          browse: {
            [key]: {
              name: `browse-${key}.gz`,
              url: `https://github.com/joe-broadhead/opencode-browse/releases/download/v0.0.0/browse-${key}.gz`,
              bytes: 1,
              sha256: "a".repeat(64),
              executable: { name: "browse", bytes: Buffer.byteLength(binary), sha256: sha(binary) },
            },
          },
        },
      }))
    }
    return { root, cacheRoot, cached: cachedPath(cacheRoot) }
  }
  const place = (path: string, bytes: string) => {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, bytes)
    chmodSync(path, 0o755)
  }
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  test("finds the cached release binary and verifies it against the pin", async () => {
    const r = release("binary")
    place(r.cached, "binary")
    const info = await resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot })
    expect(info).toMatchObject({ source: "package", version: "0.0.15", verified: true, pinned: true, tested: true, path: r.cached, pinnedSha256: sha("binary") })
  })

  test("a cached binary that is not the pinned bytes is never run: without permission it is refused, and the file stays", async () => {
    const r = release("binary")
    place(r.cached, "tampered")
    const error = await resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot }).then(() => undefined, (cause: unknown) => cause as { code?: string; nextStep?: string })
    expect(error).toMatchObject({ code: "BINARY_MISSING" })
    expect(error?.nextStep).toContain("/browse-install")
    expect(readFileSync(r.cached, "utf8")).toBe("tampered")
  })

  test("a first-use download asks first: when permission is refused, nothing is fetched or written", async () => {
    const r = release("binary")
    let asked = 0
    const refused = () => {
      asked += 1
      throw new Error("download refused by the test")
    }
    await expect(resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot, mayDownload: refused })).rejects.toThrow("download refused by the test")
    expect(asked).toBe(1)
    expect(existsSync(r.cached)).toBe(false)
  })

  test("a release manifest that does not pin the upstream binary is refused before anything runs", async () => {
    const r = release("binary", { pinned: "0".repeat(64) })
    place(r.cached, "binary")
    await expect(resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot })).rejects.toMatchObject({ code: "BINARY_UNVERIFIED" })
  })

  test("a copy with no release manifest names no binary; an option path wins over it", async () => {
    const r = release("binary", { manifest: false })
    await expect(resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot })).rejects.toMatchObject({ code: "BINARY_MISSING" })
    const own = join(r.root, "own-browse")
    writeFileSync(own, "x")
    expect(await resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot, optionPath: own })).toMatchObject({ source: "option", verified: false, tested: false })
    await expect(resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot, optionPath: join(r.root, "nope") })).rejects.toMatchObject({ code: "BINARY_MISSING" })
  })

  test("the test seam is used only with OPENCODE_BROWSE_TEST=1, and only when no release binary is named", async () => {
    const r = release("binary", { manifest: false })
    const own = join(r.root, "own-browse")
    writeFileSync(own, "x")
    expect(await resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot, env: { OPENCODE_BROWSE_TEST: "1", OPENCODE_BROWSE_BIN: own } })).toMatchObject({ source: "environment" })
    await expect(resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot, env: { OPENCODE_BROWSE_BIN: own } })).rejects.toMatchObject({ code: "BINARY_MISSING" })
  })

  test("an unsupported platform says so", async () => {
    await expect(resolveBinary({ platform: "win32", arch: "x64" })).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" })
  })

  test("verifyBinaryNow re-checks the released binary at each use: a changed file is refused, an untouched one is returned", async () => {
    const r = release("binary")
    place(r.cached, "binary")
    const info = await resolveBinary({ packageRoot: r.root, cacheRoot: r.cacheRoot })
    expect(verifyBinaryNow(info)).toBe(info)
    place(r.cached, "tampered bytes, a different size")
    expect(() => verifyBinaryNow(info)).toThrow(/^BINARY_UNVERIFIED: /)
    // An option path is never re-hashed: the person named it.
    expect(verifyBinaryNow({ ...info, source: "option", pinnedSha256: undefined })).toMatchObject({ source: "option" })
  })
})
