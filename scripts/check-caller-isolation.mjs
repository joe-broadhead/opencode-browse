// The caller-isolation probe: two MCP `tools/call` frames carrying different `_meta["ai.opencode/sessionID"]` values
// must land in two browse sessions. It is information, not a gate: the pinned browse 0.0.15 predates the per-caller
// session support (browse commit f66dce2), so it reports `isolates: no` until the plugin re-pins, and exits 0 either
// way. `scripts/check-browse-tools.mjs` runs it after the tool-table compare.
//   node scripts/check-caller-isolation.mjs <binary>
// Everything is isolated: a fresh HOME and XDG dirs under the system's /tmp, a free relay port (never browse's 19988),
// no installer, no extension, and the update check off. The relay and the MCP server it talks to are stopped before
// the script returns; nothing is left listening.
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { connect, createServer } from "node:net"
import { join } from "node:path"

const binary = process.argv[2]
if (!binary) {
  console.log("caller isolation: isolates: unknown (no binary to probe)")
  process.exit(0)
}

/** A port nothing is listening on: bind 0, read the port, close, and hand it to the relay. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })

const reachable = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port }, () => {
      socket.end()
      resolve(true)
    })
    socket.on("error", () => resolve(false))
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })

/** `browse mcp` over stdio, answering by id; the vendor server only ever speaks JSON-RPC here. */
function mcpClient(child) {
  const messages = []
  let buffer = ""
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8")
    let index
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) messages.push(JSON.parse(line))
    }
  })
  child.stderr.on("data", () => {})
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
  const answer = (id, timeoutMs) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      const timer = setInterval(() => {
        const found = messages.find((message) => message.id === id)
        if (found) {
          clearInterval(timer)
          resolve(found)
        } else if (Date.now() > deadline) {
          clearInterval(timer)
          reject(new Error(`no answer to request ${id}`))
        }
      }, 50)
    })
  return { send, answer }
}

const stop = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once("exit", resolve)
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 3_000).unref()
  })

const home = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-isolation-")))
mkdirSync(join(home, "tmp"), { recursive: true })
const port = await freePort()
const env = {
  PATH: "/usr/bin:/bin",
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  XDG_CACHE_HOME: join(home, ".cache"),
  TMPDIR: join(home, "tmp"),
  OPENCODE_BROWSER_PORT: String(port),
  OPENCODE_BROWSER_UPDATE_CHECK: "0",
  OPENCODE_BROWSER_AUTO_UPDATE: "off",
}

const relay = spawn(binary, ["serve"], { env, stdio: ["ignore", "ignore", "ignore"] })
const server = spawn(binary, ["mcp"], { env: { ...env, OPENCODE_BROWSER_MCP_DIRECT: "1" }, stdio: ["pipe", "pipe", "pipe"] })
const client = mcpClient(server)

try {
  let up = false
  for (let attempt = 0; attempt < 100 && !up; attempt++) {
    up = await reachable(port)
    if (!up) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!up) throw new Error("the relay did not start")

  client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "opencode-browse-isolation", version: "0.0.0" } } })
  const initialized = await client.answer(1, 20_000)
  client.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  const version = initialized.result?.serverInfo?.version ?? "unknown"

  const sessions = []
  for (const [id, sessionID] of [
    [2, "ses_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    [3, "ses_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"],
  ]) {
    client.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "status", arguments: {}, _meta: { "ai.opencode/sessionID": sessionID } } })
    const answer = await client.answer(id, 30_000)
    const text = answer.result?.content?.[0]?.text ?? ""
    sessions.push(/"currentSession"\s*:\s*"([^"]+)"/.exec(text)?.[1])
  }
  if (sessions.some((session) => session === undefined)) throw new Error("the status tool did not name a session")
  const isolates = sessions[0] !== sessions[1]
  console.log(`caller isolation: isolates: ${isolates ? "yes" : "no"} (browse ${version}, two session ids -> ${sessions.join(" / ")})`)
  if (!isolates) console.log("  informational: browse 0.0.15 predates per-caller sessions; each task starts its own with browse_session_new, and 0.0.16 isolates.")
} catch (error) {
  console.log(`caller isolation: isolates: unknown (${error instanceof Error ? error.message : String(error)})`)
} finally {
  await stop(server)
  await stop(relay)
  rmSync(home, { recursive: true, force: true })
}
process.exit(0)
