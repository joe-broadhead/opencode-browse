import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PINNED_VERSION } from "../../src/constants.js"
import { resolveBinary } from "../../src/provider/binary.js"
import { cachePath, readNativeManifest } from "../../src/provider/native.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-pack-")))
const tarball = (() => {
  if (process.env.PACK_TARBALL) return process.env.PACK_TARBALL
  // A checkout with core.fileMode off loses the executable bit; the package's wrapper needs it in the tarball.
  chmodSync(join(root, "bin", "mcp.mjs"), 0o755)
  const out = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", work], { cwd: root, encoding: "utf8" })
  return join(work, out.trim().split("\n").at(-1)!)
})()

const unpacked = join(work, "unpacked")
const packageRoot = join(unpacked, "package")
const unpack = () => {
  rmSync(unpacked, { recursive: true, force: true })
  mkdirSync(unpacked, { recursive: true })
  execFileSync("tar", ["-xzf", tarball, "-C", unpacked])
  return packageRoot
}

beforeAll(() => {
  if (!existsSync(join(root, "dist", "index.js"))) execFileSync("node", ["scripts/build.mjs"], { cwd: root })
  unpack()
})

afterAll(() => rmSync(work, { recursive: true, force: true }))

describe("the tarball", () => {
  const files = () => execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean).map((line) => line.replace(/^package\//, ""))

  test("ships the two bundles and the data files, and no source", () => {
    const listed = files()
    for (const wanted of ["dist/index.js", "dist/tui.js", "bin/mcp.mjs", "managed-extension/manifest.json", "manifest/browse.json", "manifest/native.json", "manifest/extension.json", "manifest/chromium.json", "NOTICE", "vendor/LICENSE.browse", "README.md", "LICENSE", "CHANGELOG.md", "skills/browse/SKILL.md", "skills/browse-capture/SKILL.md", "assets/icon.svg", "assets/icon-128.png", "assets/icon-256.png"]) {
      expect(listed, wanted).toContain(wanted)
    }
    const notice = execFileSync("tar", ["-xzOf", tarball, "package/NOTICE"], { encoding: "utf8" })
    expect(notice).toContain("managed-extension/")
    expect(notice).toContain("vendor/LICENSE.browse")
    expect(notice).toContain("not the ZIP byte for byte")
    expect(notice).toContain("public manifest key")
    expect(notice).toContain("solid-js 1.9.18")
    expect(notice).toContain("Copyright (c) 2016-2025 Ryan Carniato")
    expect(notice).toContain("b2c22c020b8e8f3930d8d15bfa3f8a52f25dc260")
    expect(notice).toContain("solid-sonner 0.3.1")
    expect(notice).toContain("Copyright (c) 2022 Robert Soriano")
    expect(notice).toContain("yaml 2.9.1 (ISC), in dist/index.js")
    expect(notice).toContain("Copyright Eemeli Aro <eemeli@gmail.com>")
    expect(notice).toContain("Permission to use, copy, modify, and/or distribute this software")
    expect(notice).toContain("does not assert a React Sonner version")
    expect(notice).not.toContain("not complete for that component")
    expect(notice).not.toContain("Required upstream material")
    expect(notice).not.toContain("No other third-party code is bundled.")
    expect(notice).not.toContain("@we-the-rebel-alliance/source-contract")
    // The manifest key is public, but the NOTICE describes its addition without printing it.
    expect(notice).not.toMatch(/MIIB[A-Za-z0-9+/]{20,}/)
    const licence = execFileSync("tar", ["-xzOf", tarball, "package/vendor/LICENSE.browse"], { encoding: "utf8" })
    expect(licence).toContain("Copyright (c) 2025 opencode")
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
    expect(listing.trim()).toStartWith("-rwxr-xr-x")
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

  test("the release manifest covers every platform and pins the upstream binaries", () => {
    const native = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/manifest/native.json"], { encoding: "utf8" }))
    const pin = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/manifest/browse.json"], { encoding: "utf8" }))
    expect(native.repository).toBe("we-the-rebel-alliance/browse-plugin")
    expect(native.tag).toBe("v0.0.0")
    expect(Object.keys(native.modules.browse).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64-gnu", "linux-x64-gnu"])
    for (const [platform, entry] of Object.entries(native.modules.browse) as [string, { executable: { sha256: string; bytes: number } }][]) {
      expect(entry.executable.sha256).toBe(pin.targets[platform].sha256)
      expect(entry.executable.bytes).toBe(pin.targets[platform].bytes)
    }
  })
})

describe("the released binary", () => {
  const key = process.platform === "darwin" ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64") : process.arch === "arm64" ? "linux-arm64-gnu" : "linux-x64-gnu"
  const cacheRoot = join(work, "cache")

  test("the packed install's manifest resolves this platform's released binary", async () => {
    const manifest = await readNativeManifest(packageRoot)
    expect(manifest).toBeDefined()
    const cached = cachePath({ manifest: manifest!, module: "browse", key, cacheRoot, installCommand: "/browse-install" })
    mkdirSync(dirname(cached), { recursive: true })
    writeFileSync(cached, "fake-browse-binary-for-pack-test")
    chmodSync(cached, 0o755)
    const info = await resolveBinary({ packageRoot, cacheRoot, verify: false })
    expect(info).toMatchObject({ source: "package", version: PINNED_VERSION, pinned: true, tested: true })
    expect(info.path).toBe(cached)
  })

  test("a packed install without manifest/native.json is refused", async () => {
    const copy = join(work, "no-native")
    cpSync(packageRoot, copy, { recursive: true })
    rmSync(join(copy, "manifest", "native.json"))
    expect(await readNativeManifest(copy)).toBeUndefined()
    await expect(resolveBinary({ packageRoot: copy, cacheRoot, verify: false })).rejects.toMatchObject({ code: "BINARY_MISSING" })
  })

  test("the pin records this platform's digest and size, and the cached bytes match it", () => {
    const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))
    const target = pin.targets[key] as { sha256: string; bytes: number } | undefined
    expect(target).toBeDefined()
    expect(target!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(target!.bytes).toBeGreaterThan(0)
    const platform = join(root, ".cache", "bin", key, "browse")
    if (!existsSync(platform)) {
      console.log("the pinned binary is not cached here; run npm run bin:ensure to compare the cached bytes")
      return
    }
    expect(createHash("sha256").update(readFileSync(platform)).digest("hex")).toBe(target!.sha256)
    expect(statSync(platform).size).toBe(target!.bytes)
    // Hashes the whole pinned binary (about 115 MB) in the test body; a loaded runner needs more than the default 5 seconds.
  }, 120_000)
})
