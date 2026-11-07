// Captures `tools/list` from the pinned browse binary, in isolation, for the test fixtures and the drift check.
//   node test/fixtures/capture-tools.mjs [binary] [out.json]
// Runs with a fresh HOME, XDG_* and TMPDIR under the system's /tmp, no installer, no pairing, no extension, and the
// update check off; the server only answers JSON-RPC on stdio. Kills only the child it started.
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))
const binary = process.argv[2] ?? join(root, ".cache", "bin", "darwin-arm64", "browse")
const out = process.argv[3] ?? join(root, "test", "fixtures", "live-tools.json")
const home = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-capture-")))
mkdirSync(join(home, "tmp"), { recursive: true })
// The guard every script that runs the binary keeps: a temp HOME, and never browse's default port 19988.
const port = Number(process.env.OPENCODE_BROWSER_PORT)
if (Number.isInteger(port) && port === 19988) throw new Error("refusing to run browse on its default port 19988")
const relayPort = Number.isInteger(port) && port > 0 ? port : 20000 + (process.pid % 20000)

const child = spawn(binary, ["mcp"], {
  env: {
    PATH: "/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: join(home, "tmp"),
    OPENCODE_BROWSER_PORT: String(relayPort),
    OPENCODE_BROWSER_MCP_DIRECT: "1",
    OPENCODE_BROWSER_UPDATE_CHECK: "0",
    OPENCODE_BROWSER_AUTO_UPDATE: "off",
  },
  stdio: ["pipe", "pipe", "pipe"],
})

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
const request = (id, method, params) => send({ jsonrpc: "2.0", id, method, params })

const waitFor = (id, timeoutMs = 30_000) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      const found = messages.find((message) => message.id === id)
      if (found) {
        clearInterval(timer)
        resolve(found)
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error(`no answer to ${id} within ${timeoutMs} ms`))
      }
    }, 50)
  })

try {
  request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "opencode-browse-capture", version: "0.0.0" } })
  const init = await waitFor(1)
  send({ jsonrpc: "2.0", method: "notifications/initialized" })
  request(2, "tools/list", {})
  const listed = await waitFor(2)
  if (listed.error) throw new Error(`tools/list failed: ${JSON.stringify(listed.error)}`)
  const fixture = {
    server: "browse",
    binary: "browse",
    listedAt: new Date().toISOString(),
    protocolVersion: init.result.protocolVersion,
    serverInfo: init.result.serverInfo,
    instructions: init.result.instructions ?? null,
    tools: listed.result.tools,
  }
  mkdirSync(join(root, "test", "fixtures"), { recursive: true })
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`)
  console.log(`browse ${init.result.serverInfo?.version}: ${fixture.tools.length} tools -> ${out}`)
  for (const tool of fixture.tools) {
    const a = tool.annotations ?? {}
    console.log(`  ${tool.name} readOnly=${a.readOnlyHint} destructive=${a.destructiveHint} idempotent=${a.idempotentHint} openWorld=${a.openWorldHint}`)
  }
} finally {
  child.kill("SIGTERM")
  setTimeout(() => child.kill("SIGKILL"), 2_000).unref()
  rmSync(home, { recursive: true, force: true })
}
