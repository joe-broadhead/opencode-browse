/**
 * Browse's part of the tools RPC (`browse.tools`): the plugin value and the method table that the source contract's
 * `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport the plugin family shares:
 *
 *   POST /api/rpc/browse.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the method's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. An MCP method then runs through OpenCode's own executor.
 */
import { toolsRpcId, type Failure, type McpResult, type MethodSpec, type NextSteps, type ShapeCall, type ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { TOOLS } from "./browse-tools.js"

/** The plugin's id. The RPC id is `<PLUGIN_ID>.tools`, which is `browse.tools`. */
export const PLUGIN_ID = "browse"

/** The RPC's id: the plugin's id and `.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Every known browse tool, by its upstream name (without the `browse_` prefix), with its class. An allowlist: a tool
 * browse adds later is not a method until this plugin classifies it in src/browse-tools.ts.
 */
export const METHODS: readonly MethodSpec[] = TOOLS.map((tool): MethodSpec => ({ kind: "mcp", name: tool.name, class: tool.class }))

/** The model path applies no per-call shaping to browse's tools. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/** The model path applies no per-result shaping to browse's tools. */
export function shapeResult(_method: string, result: McpResult, _call: ShapeCall): McpResult {
  return result
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: "Create a session in the location you mean, such as POST /api/session with {\"agent\":\"build\"} sent with the header \"x-opencode-directory: <dir>\" or the location[directory] query, and pass its id.",
  SESSION_AGENT_REQUIRED: "Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {\"agent\":\"build\",\"location\":{\"directory\":\"/path/to/project\"}}, and pass its id.",
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  SERVER_CONFLICT: "Remove your own \"browse\" server from opencode.json so that the plugin manages it, then run \"opencode reload\".",
  AUTH_REQUIRED: "Pair the browse extension: run \"browse pair\" and enter the code on the extension's options page.",
  CONNECTING: "Wait a few seconds, then call the method again.",
  CONNECTION_FAILED: "Run /browse-status and follow its next step.",
  DISABLED: "Enable the browse server in /mcps, or remove \"disabled\": true from mcp.servers.browse in opencode.json.",
  NOT_REGISTERED: "Run /browse-status and follow its next step.",
  TOOL_UNAVAILABLE: "Call describe to see which methods OpenCode lists now, and run /browse-status.",
  UPSTREAM_ERROR: "Check the input against the method's schema from describe, and run /browse-status if it keeps failing.",
  CANCELLED: "Call the method again if you still need the result.",
}

/** Browse's own errors, mapped from the plugin's codes to the RPC's shape. */
export function pluginError(error: unknown): Failure | undefined {
  if (error === null || typeof error !== "object" || !("code" in error) || !("nextStep" in error)) return undefined
  const code = (error as { code?: unknown }).code
  const next = (error as { nextStep?: unknown }).nextStep
  if (typeof code !== "string" || typeof next !== "string") return undefined
  return { code, what: "Browse refused the call.", next }
}

/** The plugin value the transport takes. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
