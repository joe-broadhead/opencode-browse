import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
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
    for (const wanted of ["dist/index.js", "dist/tui.js", "manifest/browse.json", "NOTICE", "README.md", "LICENSE", "CHANGELOG.md", "skills/browse/SKILL.md", "skills/browse-capture/SKILL.md", "assets/icon.svg", "assets/icon-128.png", "assets/icon-256.png"]) {
      expect(listed, wanted).toContain(wanted)
    }
    expect(listed.filter((file) => file.startsWith("src/"))).toEqual([])
    expect(listed.filter((file) => file.endsWith(".d.ts"))).toEqual([])
    expect(existsSync(join(root, "dist", "index.js"))).toBe(true)
  })

  test("the manifest names the four platform packages, at this plugin's version", () => {
    const pkg = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" }))
    expect(Object.keys(pkg.optionalDependencies).sort()).toEqual([
      "@joe-broadhead/opencode-browse-bin-darwin-arm64",
      "@joe-broadhead/opencode-browse-bin-darwin-x64",
      "@joe-broadhead/opencode-browse-bin-linux-arm64-gnu",
      "@joe-broadhead/opencode-browse-bin-linux-x64-gnu",
    ])
    for (const version of Object.values(pkg.optionalDependencies)) expect(version).toBe(pkg.version)
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

describe("the platform package", () => {
  const key = process.platform === "darwin" ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64") : process.arch === "arm64" ? "linux-arm64-gnu" : "linux-x64-gnu"
  const binDir = join(work, "platform", "node_modules", "@joe-broadhead", `opencode-browse-bin-${key}`)
  const binary = "fake-browse-binary-for-pack-test"

  const install = (recorded: string) => {
    rmSync(join(work, "platform"), { recursive: true, force: true })
    mkdirSync(join(binDir, "bin"), { recursive: true })
    mkdirSync(join(binDir, "manifest"), { recursive: true })
    writeFileSync(join(binDir, "bin", "browse"), binary)
    writeFileSync(join(binDir, "package.json"), JSON.stringify({ name: `@joe-broadhead/opencode-browse-bin-${key}`, version: "0.0.0" }))
    writeFileSync(
      join(binDir, "manifest", "browse.json"),
      JSON.stringify({ version: "0.0.14", sha256: recorded, bytes: binary.length, target: "test", upstream: "https://github.com/anomalyco/browse", licence: "MIT" }),
    )
  }

  test("resolves from node_modules and verifies the binary", () => {
    install(createHash("sha256").update(binary).digest("hex"))
    const info = resolveBinary({ packageRoot: join(work, "platform") })
    expect(info).toMatchObject({ source: "package", version: "0.0.14", verified: true, tested: true })
    expect(statSync(info.path).size).toBe(binary.length)
  })

  test("refuses a tampered binary before it runs", () => {
    install("0".repeat(64))
    expect(() => resolveBinary({ packageRoot: join(work, "platform") })).toThrow(/^BINARY_UNVERIFIED: /)
  })

  test("the pinned cache, when it is present, matches manifest/browse.json", () => {
    const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))
    const platform = join(root, ".cache", "bin", key, "browse")
    if (!existsSync(platform)) {
      console.log("the pinned binary is not cached here; the resolution and tamper checks above stand in")
      return
    }
    expect(createHash("sha256").update(readFileSync(platform)).digest("hex")).toBe(pin.targets[key].sha256)
    expect(statSync(platform).size).toBe(pin.targets[key].bytes)
  })
})

describe("the built plugin", () => {
  test("exports both entries, and the server entry is a plugin", async () => {
    const index = await import(join(root, "dist", "index.js"))
    expect(typeof index.default.setup).toBe("function")
    expect(index.default.id).toBe("browse")
    const files = readdirSync(join(root, "dist")).sort()
    expect(files).toEqual(["index.js", "tui.js"])
  })
})
