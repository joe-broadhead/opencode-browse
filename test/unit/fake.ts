// Narrow fakes of the public plugin context: only the members a test touches, typed with Pick<> so they
// stay valid against later 2.2.x context shapes.
import type { Plugin } from "@opencode/plugin"
import type { Rule } from "../../src/permissions.js"

type Transform<Editor> = (callback: (editor: Editor) => void) => Promise<{ dispose: () => Promise<void> }>

/** Collects transform callbacks; `run` replays them on a fresh editor value, as the host does on each rebuild. */
export function transforms<Editor>() {
  const callbacks: ((editor: Editor) => void)[] = []
  const transform: Transform<Editor> = (callback) => {
    callbacks.push(callback)
    return Promise.resolve({ dispose: async () => void callbacks.splice(callbacks.indexOf(callback), 1) })
  }
  return { transform, callbacks, run: (editor: Editor) => callbacks.forEach((callback) => callback(editor)) }
}

export type McpEditor = Parameters<Parameters<Plugin.Context["mcp"]["transform"]>[0]>[0]
export type AgentEditor = Parameters<Parameters<Plugin.Context["agent"]["transform"]>[0]>[0]
type ServerConfig = NonNullable<ReturnType<McpEditor["get"]>>

export function mcpEditor(initial: Record<string, ServerConfig> = {}) {
  const servers = new Map(Object.entries(structuredClone(initial)))
  const editor: McpEditor = {
    list: () => [...servers],
    get: (name) => servers.get(name),
    set: (name, config) => void servers.set(name, structuredClone(config) as ServerConfig),
    update: (name, update) => {
      const config = servers.get(name)
      if (config) update(config)
    },
    remove: (name) => void servers.delete(name),
  }
  return { editor, servers }
}

export type FakeAgent = { id: string; permissions: Rule[] }

/** Agents shaped like 2.2.3's built-ins: a base allow first, then each agent's own rules. */
export const builtInAgents = (): FakeAgent[] => [
  { id: "build", permissions: [allow("*"), { action: "read", resource: "*.env", effect: "ask" }] },
  { id: "plan", permissions: [allow("*"), { action: "read", resource: "*.env", effect: "ask" }, { action: "edit", resource: "*", effect: "deny" }] },
  { id: "explore", permissions: [allow("*"), { action: "*", resource: "*", effect: "deny" }, allow("read"), allow("grep")] },
]

export const allow = (action: string): Rule => ({ action, resource: "*", effect: "allow" })

export function agentEditor(agents: FakeAgent[]) {
  const editor = {
    list: () => agents,
    get: (id: string) => agents.find((agent) => agent.id === id),
    default: () => {},
    update: (id: string, update: (agent: FakeAgent) => void) => {
      const agent = agents.find((item) => item.id === id)
      if (agent) update(agent)
    },
    remove: () => {},
  }
  return editor as unknown as AgentEditor
}
