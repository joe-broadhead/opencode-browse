import { describe, expect, test } from "bun:test"
import { registerServer, serverEnvironment } from "../../src/plugin.js"
import { parseOptions } from "../../src/options.js"
import { mcpEditor, transforms } from "./fake.js"
import type { ServerSource } from "../../src/status.js"

const entry = { command: ["/opt/browse", "mcp"], environment: {} }

function register(initial: Parameters<typeof mcpEditor>[0], config: typeof entry | "none" = entry) {
  const { editor, servers } = mcpEditor(initial)
  const { transform, run } = transforms<typeof editor>()
  let source: ServerSource | undefined
  let problem: string | undefined
  const registration = registerServer({ transform } as never, config === "none" ? undefined : config, (next, nextProblem) => {
    source = next
    problem = nextProblem
  })
  run(editor)
  return { servers, source, problem, registration }
}

describe("registerServer", () => {
  test("sets a local server with the pinned binary", async () => {
    const { servers, source } = register({})
    expect(source).toEqual({ type: "plugin", command: "/opt/browse mcp" })
    expect(servers.get("browse")).toEqual({ type: "local", command: ["/opt/browse", "mcp"], environment: {} })
  })

  test("adopts the installer's entry by replacing only the command", async () => {
    const { servers, source } = register({
      browse: { type: "local", command: ["local/browse", "mcp"], environment: { OPENCODE_BROWSER_RUNTIME: "auto-update" }, disabled: true },
    } as never)
    expect(source).toEqual({ type: "adopted", command: "/opt/browse mcp" })
    expect(servers.get("browse")).toEqual({
      type: "local",
      command: ["/opt/browse", "mcp"],
      environment: { OPENCODE_BROWSER_RUNTIME: "auto-update" },
      disabled: true,
    })
  })

  test("adopts a global npm entry and keeps its other keys", async () => {
    const { servers } = register({
      browse: { type: "local", command: ["node", "global/@opencode/browse/dist/cli.mjs", "mcp"], environment: { OTHER: "1" }, timeout: { startup: 45000 } },
    } as never)
    expect(servers.get("browse")).toMatchObject({ command: ["/opt/browse", "mcp"], environment: { OTHER: "1" }, timeout: { startup: 45000 } })
  })

  test("a different command is a conflict and nothing is written", async () => {
    const { servers, source } = register({ browse: { type: "local", command: ["node", "/x/other-mcp.js", "mcp"] } } as never)
    expect(source).toMatchObject({ type: "conflict" })
    expect(servers.get("browse")).toEqual({ type: "local", command: ["node", "/x/other-mcp.js", "mcp"] })
  })

  test("a remote server under the name is a conflict", async () => {
    const { source } = register({ browse: { type: "remote", url: "https://example.com/mcp" } } as never)
    expect(source).toEqual({ type: "conflict", command: "remote", expected: "/opt/browse mcp" })
  })

  test("with no binary and no entry, nothing is registered", async () => {
    const { servers, source } = register({}, "none")
    expect(source).toBeUndefined()
    expect(servers.size).toBe(0)
  })

  test("a transform failure becomes SERVER_NOT_REGISTERED", () => {
    const { transform, run } = transforms<{ get: (name: string) => never }>()
    let problem: string | undefined
    void registerServer({ transform } as never, entry, (_source, nextProblem) => (problem = nextProblem))
    run({ get: () => { throw new Error("boom") } })
    expect(problem).toStartWith("SERVER_NOT_REGISTERED: The browse MCP server could not be registered (boom).")
    expect(problem).toContain("Next step: Restart OpenCode.")
  })
})

describe("the server environment", () => {
  test("carries the session pin only, and only when scoped", () => {
    expect(serverEnvironment(parseOptions({}))).toEqual({})
    expect(serverEnvironment(parseOptions({ scope: { session: "work" } }))).toEqual({ OPENCODE_BROWSER_SESSION: "work" })
  })

  test("never sets an ALLOW_* switch", () => {
    const environment = serverEnvironment(parseOptions({ scope: { readOnly: true, allowedOrigins: ["github.com"] } }))
    expect(Object.keys(environment)).toEqual(["OPENCODE_BROWSER_SESSION"])
  })
})
