import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PINNED_VERSION } from "../../src/constants.js"
import { resolveBinary } from "../../src/engine.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-pack-")))
const tarball = (() => {
  if (process.env.PACK_TARBALL) return process.env.PACK_TARBALL
  const out = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", work], { cwd: root, encoding: "utf8" })
  return join(work, out.trim().split("\n").at(-1)!)
})()

beforeAll(() => {
  if (!existsSync(join(root, "dist", "index.js"))) execFileSync("node", ["scripts/build.mjs"], { cwd: root })
})

afterAll(() => rmSync(work, { recursive: true, force: true }))

describe("the tarball", () => {
  const files = () => execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean).map((line) => line.replace(/^package\//, ""))

  test("ships the two bundles and the data files, and no source", () => {
    const listed = files()
    for (const wanted of ["dist/index.js", "dist/tui.js", "bin/mcp.mjs", "managed-extension/manifest.json", "manifest/browse.json", "manifest/extension.json", "manifest/chromium.json", "NOTICE", "README.md", "LICENSE", "CHANGELOG.md", "skills/browse/SKILL.md", "skills/browse-capture/SKILL.md", "assets/icon.svg", "assets/icon-128.png", "assets/icon-256.png"]) {
      expect(listed, wanted).toContain(wanted)
    }
    expect(listed.filter((file) => file.startsWith("src/"))).toEqual([])
    expect(listed.filter((file) => file.endsWith(".d.ts"))).toEqual([])
    expect(existsSync(join(root, "dist", "index.js"))).toBe(true)
  })

  test("the package names no platform package: the binary is downloaded from the release on first use", () => {
    const pkg = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" }))
    expect(pkg.optionalDependencies).toBeUndefined()
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.peerDependencies).toBeUndefined()
  })

  test("the bundles are self-contained, and the TUI bundle is small", () => {
    for (const name of ["index.js", "tui.js"]) {
      const text = execFileSync("tar", ["-xzOf", tarball, `package/dist/${name}`], { encoding: "utf8" })
      expect(text, name).not.toMatch(/from\s+["']\.\.?\//)
      expect(text, name).not.toMatch(/import\(\s*["']\.\.?\//)
    }
    const tui = execFileSync("tar", ["-xzOf", tarball, "package/dist/tui.js"], { encoding: "utf8" })
    expect(Buffer.byteLength(tui)).toBeLessThan(30 * 1024)
    expect(tui).not.toContain("zod")
  })

  test("the managed artefacts are pinned: the extension per file, Chrome for Testing per platform", () => {
    const extension = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/manifest/extension.json"], { encoding: "utf8" }))
    // The extension moves with the CLI binary: the two pins name the same release.
    expect(extension.version).toBe(PINNED_VERSION)
    expect(extension.zip.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(extension.files.length).toBeGreaterThan(10)
    for (const file of extension.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    const chromium = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/manifest/chromium.json"], { encoding: "utf8" }))
    expect(chromium.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    for (const key of ["darwin-arm64", "darwin-x64", "linux-x64-gnu", "linux-arm64-gnu"]) {
      expect(chromium.platforms[key].sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(chromium.platforms[key].bytes).toBeGreaterThan(1_000_000)
    }
    // The MCP wrapper is executable in the tarball: OpenCode spawns the path directly.
    const listing = execFileSync("tar", ["-tvzf", tarball, "package/bin/mcp.mjs"], { encoding: "utf8" })
    expect(listing.startsWith("-rwxr-xr-x")).toBe(true)
    expect(execFileSync("tar", ["-xzOf", tarball, "package/bin/mcp.mjs"], { encoding: "utf8" }).startsWith("#!/usr/bin/env node")).toBe(true)
  })

  test("the pinned manifest records four targets, each with a digest and a size", () => {
    const pin = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/manifest/browse.json"], { encoding: "utf8" }))
    expect(pin.app).toBe("browse")
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(Object.keys(pin.targets).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64-gnu", "linux-x64-gnu"])
    for (const target of Object.values(pin.targets) as { sha256: string; bytes: number; tgzSha256: string }[]) {
      expect(target.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(target.tgzSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(target.bytes).toBeGreaterThan(0)
    }
  })
})

describe("the released binary", () => {
  const key = process.platform === "darwin" ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64") : process.arch === "arm64" ? "linux-arm64-gnu" : "linux-x64-gnu"
  const binary = "fake-browse-binary-for-pack-test"
  const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex")

  /** A package root with the upstream pin and a release manifest for this platform, and the released binary cached. */
  const install = (pinned: string) => {
    const packageRoot = join(work, "release")
    rmSync(packageRoot, { recursive: true, force: true })
    mkdirSync(join(packageRoot, "manifest"), { recursive: true })
    writeFileSync(join(packageRoot, "manifest", "browse.json"), JSON.stringify({ version: PINNED_VERSION, upstream: "https://github.com/anomalyco/browse", licence: "MIT", targets: { [key]: { target: "test", sha256: pinned, bytes: binary.length } } }))
    writeFileSync(
      join(packageRoot, "manifest", "native.json"),
      JSON.stringify({
        schema: 1,
        plugin: "opencode-browse",
        repository: "joe-broadhead/opencode-browse",
        tag: "v0.0.0",
        built: { commit: "0".repeat(40), run: 1, workflow: "native" },
        modules: { browse: { [key]: { name: `browse-${key}.gz`, url: `https://github.com/joe-broadhead/opencode-browse/releases/download/v0.0.0/browse-${key}.gz`, bytes: 1, sha256: "a".repeat(64), executable: { name: "browse", bytes: binary.length, sha256: sha(binary) } } } },
      }),
    )
    const cached = join(packageRoot, "cache", "native", "v0.0.0", "browse", key, "browse")
    mkdirSync(join(cached, ".."), { recursive: true })
    writeFileSync(cached, binary)
    chmodSync(cached, 0o755)
    return packageRoot
  }

  test("resolves the cached release binary and verifies it against the pin", async () => {
    const packageRoot = install(sha(binary))
    const info = await resolveBinary({ packageRoot, cacheRoot: join(packageRoot, "cache") })
    expect(info).toMatchObject({ source: "package", version: PINNED_VERSION, verified: true, tested: true })
    expect(statSync(info.path).size).toBe(binary.length)
  })

  test("refuses a release whose manifest does not pin the upstream binary, before anything runs", async () => {
    const packageRoot = install("0".repeat(64))
    await expect(resolveBinary({ packageRoot, cacheRoot: join(packageRoot, "cache") })).rejects.toMatchObject({ code: "BINARY_UNVERIFIED" })
  })

  test("the pinned cache, when it is present, matches manifest/browse.json", () => {
    const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))
    const platform = join(root, ".cache", "bin", key, "browse")
    if (!existsSync(platform)) {
      console.log("the pinned binary is not cached here; run npm run bin:ensure to check the real bytes")
      return
    }
    expect(createHash("sha256").update(readFileSync(platform)).digest("hex")).toBe(pin.targets[key].sha256)
    expect(statSync(platform).size).toBe(pin.targets[key].bytes)
    // Hashes the whole pinned binary (about 115 MB) in the test body; a loaded runner needs more than the default 5 seconds.
  }, 120_000)
})
