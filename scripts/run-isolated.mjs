// Runs the pinned browse binary with a throwaway HOME, XDG dirs and a free port, then stops the relay it started.
// The safe way to probe by hand: a plain `browse status` with your real HOME creates ~/.local/share/browse/relay-token
// and can leave a daemonised relay behind.
//
//   npm run browse:isolated -- status --json
//   npm run browse:isolated -- --version
import { spawn } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, readFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
// The pinned binary build-native.mjs fetched and verified into .cache/bin (the same bytes the release ships).
const binary = join(root, ".cache", "bin", platformKey(), "browse")
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("usage: node scripts/run-isolated.mjs <browse args…>")
  process.exit(2)
}
const home = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-isolated-")))
const port = await freePort()
const env = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  XDG_CACHE_HOME: join(home, ".cache"),
  TMPDIR: join(home, "tmp"),
  OPENCODE_BROWSER_PORT: String(port),
  OPENCODE_BROWSER_MCP_DIRECT: "1",
  OPENCODE_BROWSER_AUTO_UPDATE: "off",
}
const child = spawn(binary, args, { env, stdio: "inherit" })
const code = await new Promise((resolve) => child.on("exit", (exit) => resolve(exit ?? 1)))
await stopRelay()
rmSync(home, { recursive: true, force: true })
process.exit(code)

function platformKey() {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64"
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64"
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64-gnu"
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64-gnu"
  throw new Error(`no pinned browse binary for ${process.platform}-${process.arch}`)
}

function freePort() {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
}

/** browse's own shutdown, then a wait for the port to close. Only a relay this run started can answer here. */
async function stopRelay() {
  const base = `http://127.0.0.1:${port}`
  try {
    const version = await fetch(`${base}/version`, { signal: AbortSignal.timeout(1_000) }).then((response) => (response.ok ? response.json() : undefined), () => undefined)
    if (!version?.managed || !version.instanceId) return
    const token = readFileSync(join(env.XDG_DATA_HOME, "browse", "relay-token"), "utf8").trim()
    await fetch(`${base}/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        instanceId: version.instanceId,
        requestId: `isolated-${Date.now()}`,
        reason: "explicit-restart",
        force: true,
        client: { kind: "cli", instanceId: `isolated-${process.pid}`, buildId: version.buildId ?? "0.0.0" },
      }),
    })
    for (let index = 0; index < 60; index++) {
      if (!(await fetch(`${base}/version`, { signal: AbortSignal.timeout(500) }).then((response) => response.ok, () => false))) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  } catch {
    // Nothing running, or already gone.
  }
}
