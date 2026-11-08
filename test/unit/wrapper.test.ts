// The MCP wrapper the plugin registers: it re-verifies the pinned binary at every spawn, so a changed file is refused,
// and it never hands off to another `browse` on the machine (browse's supervisor is off). No browser, relay or
// extension is touched: the fake "binary" is a Node script that answers on stdio.
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))
const wrapper = join(root, "bin", "mcp.mjs")

const platform = (() => {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64"
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64"
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64-gnu"
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64-gnu"
  return undefined
})()

/** A package tree: bin/mcp.mjs plus a platform package whose binary is `binary`. */
function tree(binary: string) {
  const dir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-wrapper-")))
  mkdirSync(join(dir, "package", "bin"), { recursive: true })
  copyFileSync(wrapper, join(dir, "package", "bin", "mcp.mjs"))
  const binDir = join(dir, "package", "node_modules", "@joe-broadhead", `opencode-browse-bin-${platform}`)
  mkdirSync(join(binDir, "bin"), { recursive: true })
  mkdirSync(join(binDir, "manifest"), { recursive: true })
  writeFileSync(join(binDir, "bin", "browse"), binary)
  chmodSync(join(binDir, "bin", "browse"), 0o755)
  writeFileSync(join(binDir, "manifest", "browse.json"), JSON.stringify({ version: "0.0.14", sha256: createHash("sha256").update(binary).digest("hex"), bytes: binary.length, target: "test", upstream: "x", licence: "MIT" }))
  writeFileSync(join(binDir, "package.json"), JSON.stringify({ name: `@joe-broadhead/opencode-browse-bin-${platform}`, version: "0.0.0" }))
  // A user's own install, which must never be run.
  mkdirSync(join(dir, "home", ".local", "bin"), { recursive: true })
  writeFileSync(join(dir, "home", ".local", "bin", "browse"), `#!/bin/sh\necho handoff >> ${join(dir, "handoff.txt")}\nexit 0\n`)
  chmodSync(join(dir, "home", ".local", "bin", "browse"), 0o755)
  return { dir, binDir, home: join(dir, "home"), handoff: join(dir, "handoff.txt"), binary: join(binDir, "bin", "browse") }
}

const run = (dir: string, home: string) =>
  spawnSync(process.execPath, [join(dir, "package", "bin", "mcp.mjs"), join(dir, "package", "node_modules", "@joe-broadhead", `opencode-browse-bin-${platform}`, "bin", "browse"), "mcp"], {
    encoding: "utf8",
    timeout: 15_000,
    env: { PATH: "/usr/bin:/bin", HOME: home, XDG_DATA_HOME: join(home, ".local", "share"), OPENCODE_BROWSER_TEST: "1" },
  })

describe("bin/mcp.mjs", () => {
  if (platform === undefined) test.skip("no platform package for this machine", () => undefined)

  test("runs the pinned binary and never the user's ~/.local/bin/browse", () => {
    const fake = tree('#!/bin/sh\necho SERVED-BY-PINNED\n')
    try {
      const result = run(fake.dir, fake.home)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("SERVED-BY-PINNED")
      expect(result.stdout).not.toContain("handoff")
      expect(existsSync(fake.handoff)).toBe(false)
    } finally {
      rmSync(fake.dir, { recursive: true, force: true })
    }
  })

  test("refuses a binary that changed after the pin, before running it", () => {
    const fake = tree('#!/bin/sh\necho SERVED\n')
    try {
      writeFileSync(fake.binary, '#!/bin/sh\necho TAMPERED\n')
      const result = run(fake.dir, fake.home)
      expect(result.status).toBe(78)
      expect(result.stderr).toContain("BINARY_UNVERIFIED:")
      expect(result.stdout).not.toContain("TAMPERED")
    } finally {
      rmSync(fake.dir, { recursive: true, force: true })
    }
  })

  test("caches the verified digest by file identity, and neither hashes nor rewrites it on a hit", () => {
    const fake = tree('#!/bin/sh\necho SERVED\n')
    try {
      const cacheFile = join(fake.home, ".local", "share", "opencode-browse", "cache", "binary-integrity.json")
      expect(run(fake.dir, fake.home).status).toBe(0)
      expect(existsSync(cacheFile)).toBe(true)
      expect(statSync(cacheFile).mode & 0o777).toBe(0o600)
      const manifest = JSON.parse(readFileSync(join(fake.binDir, "manifest", "browse.json"), "utf8"))
      const first = readFileSync(cacheFile, "utf8")
      expect(JSON.parse(first)[fake.binary]).toMatchObject({ sha256: manifest.sha256, size: String(manifest.bytes) })

      // The wrapper writes the cache only on a miss, so an unchanged file proves the hit branch ran: no hash.
      const before = statSync(cacheFile)
      expect(run(fake.dir, fake.home).status).toBe(0)
      const after = statSync(cacheFile)
      expect(after.ino).toBe(before.ino)
      expect(after.mtimeMs).toBe(before.mtimeMs)
      expect(readFileSync(cacheFile, "utf8")).toBe(first)
    } finally {
      rmSync(fake.dir, { recursive: true, force: true })
    }
  })

  test("a metadata change alone is a miss: it re-hashes, rewrites the cache, and still runs", () => {
    const fake = tree('#!/bin/sh\necho SERVED\n')
    try {
      const cacheFile = join(fake.home, ".local", "share", "opencode-browse", "cache", "binary-integrity.json")
      expect(run(fake.dir, fake.home).status).toBe(0)
      const before = statSync(cacheFile)
      chmodSync(fake.binary, 0o777)
      const result = run(fake.dir, fake.home)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("SERVED")
      const after = statSync(cacheFile)
      expect({ ino: after.ino, mtimeMs: after.mtimeMs }).not.toEqual({ ino: before.ino, mtimeMs: before.mtimeMs })
    } finally {
      rmSync(fake.dir, { recursive: true, force: true })
    }
  })

  test("a changed byte misses the cache and is refused, even after the mtime is put back", () => {
    const fake = tree('#!/bin/sh\necho SERVED\n')
    try {
      const original = statSync(fake.binary)
      expect(run(fake.dir, fake.home).status).toBe(0)
      writeFileSync(fake.binary, '#!/bin/sh\necho TAMPERED\n')
      chmodSync(fake.binary, 0o755)
      // Put the mtime back: only ctime (and the content) still differ, and the wrapper must notice.
      utimesSync(fake.binary, original.atime, original.mtime)
      const result = run(fake.dir, fake.home)
      expect(result.status).toBe(78)
      expect(result.stderr).toContain("BINARY_UNVERIFIED:")
      expect(result.stdout).not.toContain("TAMPERED")
    } finally {
      rmSync(fake.dir, { recursive: true, force: true })
    }
  })

  test("passes the two switches to the child, so the binary serves instead of supervising", () => {
    const fake = tree('#!/bin/sh\necho "direct=$OPENCODE_BROWSER_MCP_DIRECT update=$OPENCODE_BROWSER_AUTO_UPDATE"\n')
    try {
      const result = run(fake.dir, fake.home)
      expect(result.stdout.trim()).toBe("direct=1 update=off")
    } finally {
      rmSync(fake.dir, { recursive: true, force: true })
    }
  })
})
