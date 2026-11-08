// The browse-specific script path: `browse.tools` with the real 18-tool table, through the shared resolve. A read
// runs, `execute` is refused with no prompt and no server call, and a capture runs under the owner's default.
import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { METHODS, NEXT_STEPS, registerToolsRpc, type MethodSpec, type ToolCall } from "../../src/host/tools-rpc.js"
import { defaultRules, insertRules, type Rule } from "../../src/permissions.js"

type Effect = "allow" | "deny" | "ask"
type Handler = (input: unknown, context: { signal: AbortSignal; error: (type: string, message: string, data?: unknown) => unknown }) => Promise<any>

const LOCATION = join(tmpdir(), "browse-tools-rpc")
const SERVER = "browse"
const rule = (action: string, effect: Effect, resource = "*"): Rule => ({ action, resource, effect })
const match = (pattern: string, value: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value)

/** The MCP-only next steps this block carries are complete; the shim is only for a copy that omits them. */
function steps() {
  const all = NEXT_STEPS as Record<string, string | undefined>
  all.AUTH_REQUIRED ??= "Pair the browser."
  all.CONNECTING ??= "Wait a few seconds."
  all.CONNECTION_FAILED ??= "Run /browse-status."
  all.DISABLED ??= "Enable the server."
  all.NOT_REGISTERED ??= "Run /browse-status."
  all.TOOL_UNAVAILABLE ??= "Call describe."
  all.UPSTREAM_ERROR ??= "Check the input."
}

async function harness(agentPermissions: Rule[], sessionPermissions: Rule[] = []) {
  steps()
  const executions: string[] = []
  const agents: Record<string, Rule[]> = { build: [...agentPermissions] }
  const session = { agent: "build", permissions: [...sessionPermissions] }
  const check = (call: ToolCall, action: string) => {
    const configured = [...agents[call.agent]!, ...session.permissions]
    const effect = configured.findLast((entry) => match(entry.action, action) && match(entry.resource, "*"))?.effect ?? "ask"
    if (effect !== "allow") throw Object.assign(new Error("blocked"), { _tag: "Permission.BlockedError" })
  }
  const handlers: Record<string, Handler> = {}
  const ctx = {
    location: { directory: LOCATION },
    rpc: {
      register: async (_definition: unknown, registered: Record<string, Handler>) => {
        Object.assign(handlers, registered)
        return { dispose: async () => undefined, events: { emit: async () => undefined } }
      },
    },
    permission: { hook: async () => ({ dispose: async () => undefined }), assert: async () => undefined },
    session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory: LOCATION }, ...session }) },
    agent: { get: async ({ agentID }: { agentID: string }) => ({ data: { id: agentID, permissions: agents[agentID] } }) },
    tool: {
      list: async () =>
        (METHODS as readonly MethodSpec[]).map((method) => ({
          id: `${SERVER}_${method.name}`,
          name: `${SERVER}_${method.name}`,
          description: "",
          input: { type: "object" },
          execute: async (_input: unknown, call: ToolCall) => {
            check(call, `${SERVER}_${method.name}`)
            executions.push(method.name)
            return { output: { called: method.name }, content: [{ type: "text", text: `called ${method.name}` }] }
          },
        })),
    },
    mcp: { list: async () => ({ data: [{ name: SERVER, status: { status: "connected" } }] }) },
  }
  const stop = await registerToolsRpc(ctx as never, { methods: METHODS, mcp: { server: SERVER, managed: () => true } })
  const context = { signal: new AbortController().signal, error: (type: string, message: string, data?: unknown) => ({ type, message, data }) }
  const call = (method: string, input: Record<string, unknown> = {}) => handlers[method]!({ sessionID: "ses_1", input }, context)
  return { call, executions, stop }
}

const DEFAULTS: Rule[] = [rule("*", "allow")]
insertRules(DEFAULTS, defaultRules())

describe("the table", () => {
  test("is browse.tools with the 18 known tools and their classes", async () => {
    const { TOOLS } = await import("../../src/browse-tools.js")
    expect(METHODS).toHaveLength(18)
    expect(METHODS.map((method) => ({ name: method.name, class: method.class }))).toEqual(TOOLS.map((tool) => ({ name: tool.name, class: tool.class })))
    for (const method of METHODS) expect(method.kind).toBe("mcp")
  })
})

describe("browse.tools with the real table", () => {
  test("a read runs with no prompt", async () => {
    const { call, executions } = await harness(DEFAULTS)
    const answer = await call("status")
    expect(answer).toMatchObject({ output: { called: "status" }, text: "called status" })
    expect(executions).toEqual(["status"])
  })

  test("execute runs under the default allow, and a rule the user adds refuses it with no server call", async () => {
    const allowed = await harness(DEFAULTS)
    expect(await allowed.call("execute", { code: "return 1" })).toMatchObject({ output: { called: "execute" } })
    expect(allowed.executions).toContain("execute")

    const { call, executions } = await harness([...DEFAULTS, rule("browse_execute", "deny")])
    const answer = await call("execute", { code: "return 1" })
    expect(answer).toMatchObject({ type: "failed", data: { code: "PERMISSION_DENIED" } })
    expect(executions).not.toContain("execute")
  })

  test("a capture runs under the owner's default", async () => {
    const { call, executions } = await harness(DEFAULTS)
    expect(await call("network", { action: "start" })).toMatchObject({ output: { called: "network" } })
    expect(executions).toContain("network")
  })

  test("a capture the user turned off is refused, and an unknown method is not one", async () => {
    const { call, executions } = await harness([...DEFAULTS, rule("browse_network", "deny")])
    expect(await call("network", { action: "start" })).toMatchObject({ type: "failed", data: { code: "PERMISSION_DENIED" } })
    expect(executions).not.toContain("network")
    expect(METHODS.map((method) => method.name)).not.toContain("shiny_new_tool")
  })

  test("the session's own rules apply after the agent's", async () => {
    const { call, executions } = await harness(DEFAULTS, [rule("browse_secrets_run", "allow")])
    expect(await call("secrets_run", { name: "p", command: "true" })).toMatchObject({ output: { called: "secrets_run" } })
    expect(executions).toContain("secrets_run")
  })
})
