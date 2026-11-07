#!/usr/bin/env node
// A stand-in for the pinned browse binary, for the host and pack tests. It speaks the same stdio MCP protocol and the
// same few CLI commands this plugin runs, and it never touches a browser, a relay or an extension.
//
//   browse --version            prints config.version
//   browse mcp                  stdio JSON-RPC: initialize, tools/list (config.tools), tools/call, ping
//   browse status --json        prints the status envelope (config.status), exit config.statusExit
//   browse session list --json  { current, sessions } from its own state file
//   browse session new|allow|delete ...   mutate that state, append to calls.jsonl
//   browse doctor --json        prints config.doctor
//
// Its config sits beside it as fake-browse.json: { version, tools, status, statusExit, doctor, sessions, current }.
// Every call is appended to calls.jsonl in the same folder, one JSON object a line.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const configPath = join(here, "fake-browse.json")
const callsPath = join(here, "calls.jsonl")

const load = () => {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"))
  } catch {
    return {}
  }
}
const save = (config) => writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
const record = (entry) => appendFileSync(callsPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)

const config = load()
const version = config.version ?? "0.0.14"
const args = process.argv.slice(2)

if (args.length === 0 || args.includes("--version")) {
  process.stdout.write(`${version}\n`)
  process.exit(0)
}

if (args[0] === "mcp") {
  const tools = Array.isArray(config.tools) ? config.tools : []
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
  let buffer = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result })
      if (message.method === "initialize") {
        reply({ protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "browse", version }, instructions: "Fake browse for tests." })
      } else if (message.method === "notifications/initialized") {
        // A notification takes no answer.
      } else if (message.method === "tools/list") {
        reply({ tools })
      } else if (message.method === "tools/call") {
        const name = message.params?.name ?? ""
        const input = message.params?.arguments ?? {}
        record({ kind: "tool", tool: name, input })
        const call = config.calls?.[name]
        if (call === "error") {
          reply({ content: [{ type: "text", text: "Upstream refused https://files.example/a.pdf?signature=abc123\nsecond line" }], isError: true })
        } else {
          reply({ content: [{ type: "text", text: `called ${name}` }], structuredContent: { tool: name, arguments: input } })
        }
      } else if (message.method === "ping") {
        reply({})
      } else if (message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } })
      }
    }
  })
  process.stdin.on("end", () => process.exit(0))
} else if (args[0] === "status") {
  const status = config.status ?? {
    endpoint: "http://127.0.0.1:19988",
    relay: { running: false },
    extension: null,
    sessions: config.sessions ?? [],
    targets: [],
  }
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
  if (config.statusReason) process.stderr.write(`${config.statusReason}\n`)
  process.exit(config.statusExit ?? 0)
} else if (args[0] === "session") {
  const command = args[1]
  const current = load()
  const sessions = Array.isArray(current.sessions) ? current.sessions : []
  if (command === "list") {
    record({ kind: "session", command, args: args.slice(2) })
    process.stdout.write(`${JSON.stringify({ current: current.current, sessions }, null, 2)}\n`)
  } else if (command === "new") {
    const id = args[2]
    const readOnly = args.includes("--read-only")
    const allowedOrigins = []
    for (let index = 0; index < args.length; index += 1) if (args[index] === "--allow-origin" && args[index + 1]) allowedOrigins.push(...String(args[index + 1]).split(","))
    save({ ...current, current: id, sessions: [...sessions.filter((session) => session.id !== id), { id, readOnly, allowedOrigins, pageUrl: null, stateKeys: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), connected: false }] })
    record({ kind: "session", command, id, readOnly, allowedOrigins })
    process.stdout.write(`${id}\n`)
  } else if (command === "allow") {
    const at = args.indexOf("--session")
    const id = at === -1 ? undefined : args[at + 1]
    const rest = args.slice(2).filter((arg) => arg !== "--session" && arg !== id)
    const clear = rest.includes("--clear")
    const origins = rest.filter((arg) => arg !== "--clear")
    const next = sessions.map((session) => (session.id === id ? { ...session, allowedOrigins: clear ? [] : origins } : session))
    save({ ...current, sessions: next })
    record({ kind: "session", command, id, allowedOrigins: clear ? [] : origins })
    process.stdout.write("ok\n")
  } else if (command === "delete") {
    const id = args[2]
    save({ ...current, sessions: sessions.filter((session) => session.id !== id) })
    record({ kind: "session", command, id })
    process.stdout.write("ok\n")
  } else {
    process.stderr.write(`unknown session command ${command}\n`)
    process.exit(2)
  }
} else if (args[0] === "doctor") {
  process.stdout.write(`${JSON.stringify(config.doctor ?? { status: "ok", checks: [] }, null, 2)}\n`)
  process.exit(config.doctorExit ?? 0)
} else if (args[0] === "install" || args[0] === "update" || args[0] === "pair" || args[0] === "uninstall") {
  record({ kind: "forbidden", command: args[0] })
  process.stderr.write(`the plugin must never run browse ${args[0]}\n`)
  process.exit(9)
} else {
  process.stderr.write(`fake browse: unsupported ${args.join(" ")}\n`)
  process.exit(2)
}
