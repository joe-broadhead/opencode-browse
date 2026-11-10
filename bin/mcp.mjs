#!/usr/bin/env node
// The MCP entry OpenCode runs. When the plugin passes `--pinned <sha256>`, it re-verifies the released browse binary at
// every spawn, then serves it with browse's own supervision and auto-update switched off, so the pin binds: no other
// `browse` executable on this machine can be handed off to, and the relay cannot replace the file under us.
//
//   <node> bin/mcp.mjs [--pinned <sha256>] <binary> mcp
//
// The released binary is downloaded on first use and cached (src/engine.ts); the plugin passes its pinned SHA-256 here.
// A binary the user named with the `path` option is passed without `--pinned` and runs as given (status reports it
// unverified). A digest that does not match prints BINARY_UNVERIFIED and exits 78 before any browser code runs.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"

function fail(message) {
  process.stderr.write(`BINARY_UNVERIFIED: ${message} Next step: Run /browse-install, or restart OpenCode.\n`)
  process.exit(78)
}

const argv = process.argv.slice(2)
let pinned
if (argv[0] === "--pinned") {
  pinned = argv[1]
  if (!/^[a-f0-9]{64}$/.test(pinned ?? "")) fail("the pinned SHA-256 is not a SHA-256.")
  argv.splice(0, 2)
}
const [binaryArg, ...args] = argv
if (!binaryArg) {
  process.stderr.write("BINARY_MISSING: bin/mcp.mjs needs the browse binary path. Next step: Run /browse-install, or restart OpenCode.\n")
  process.exit(78)
}
const binary = resolve(binaryArg)
if (!existsSync(binary)) fail(`the browse binary at ${binary} does not exist`)

if (pinned !== undefined) {
  // The verified digest is cached against the file's identity: device, inode, size, mtime and ctime. A replaced or
  // edited file differs in at least one of them (user space cannot set ctime) and is re-hashed in full. The pin is
  // always the reference.
  const stat = statSync(binary, { bigint: true })
  const key = {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  }
  const cacheFile = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode-browse", "cache", "binary-integrity.json")
  const cached = (() => {
    try {
      const all = JSON.parse(readFileSync(cacheFile, "utf8"))
      const entry = all[binary]
      return entry && entry.sha256 === pinned && Object.keys(key).every((name) => entry[name] === key[name]) ? entry : undefined
    } catch {
      return undefined
    }
  })()
  if (cached === undefined) {
    const digest = createHash("sha256").update(readFileSync(binary)).digest("hex")
    if (digest !== pinned) fail("the browse binary does not match the SHA-256 its release pins")
    try {
      mkdirSync(join(cacheFile, ".."), { recursive: true, mode: 0o700 })
      const all = (() => {
        try {
          return JSON.parse(readFileSync(cacheFile, "utf8"))
        } catch {
          return {}
        }
      })()
      all[binary] = { ...key, sha256: digest }
      const temporary = `${cacheFile}.${process.pid}.tmp`
      writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporary, cacheFile)
    } catch {
      // A cache that cannot be written only costs a re-hash next time.
    }
  }
}

const child = spawn(binary, args.length ? args : ["mcp"], {
  stdio: "inherit",
  env: { ...process.env, OPENCODE_BROWSER_MCP_DIRECT: "1", OPENCODE_BROWSER_AUTO_UPDATE: "off" },
})
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal)
  })
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
child.on("error", (error) => {
  process.stderr.write(`BINARY_MISSING: the browse binary could not start (${error.message}). Next step: Run /browse-install, or restart OpenCode.\n`)
  process.exit(78)
})
