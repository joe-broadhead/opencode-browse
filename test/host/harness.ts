// An embedded OpenCode host from the public @opencode/sdk, isolated in the temp root from ./isolate.js: the
// environment, config, database and project directory all live there, and any fetch that leaves loopback fails the
// run. The plugin is given the fake browse binary through its `path` option, and a probe plugin loaded after it lends
// its context to the tests.
import { HOST_SDK_DIR, ROOT as root } from "./isolate.js"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { OpenCodeClient } from "@opencode/client"
import { Plugin } from "@opencode/plugin"
import { createBrowsePlugin } from "../../src/plugin.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { startFakeBinary, type FakeScenario } from "./fake-browse.js"

export type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }

type Client = Omit<OpenCodeClient, "plugin"> & {
  readonly sessions: OpenCodeClient["session"]
  readonly plugin: ((plugin: Plugin.Plugin) => Promise<void>) & OpenCodeClient["plugin"]
  readonly close: () => Promise<void>
}

const SDK = HOST_SDK_DIR ? join(HOST_SDK_DIR, "node_modules", "@opencode", "sdk") : fileURLToPath(new URL("../../node_modules/@opencode/sdk", import.meta.url))
export const HOST_VERSION = (JSON.parse(readFileSync(join(SDK, "package.json"), "utf8")) as { version: string }).version

const offLoopback: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return realFetch(input, init)
    offLoopback.push(url.origin)
    return Promise.reject(new Error(`host test blocked a fetch to ${url.origin}`))
  },
  { preconnect: realFetch.preconnect },
) as typeof fetch

export const cleanup = () => rmSync(root, { recursive: true, force: true })

const skillsDir = join(root, "skills")
for (const name of SKILL_NAMES) {
  mkdirSync(join(skillsDir, name), { recursive: true })
  writeFileSync(join(skillsDir, name, "SKILL.md"), `---\nname: ${name}\ndescription: Host test ${name} skill.\n---\nBody.\n`)
}

export interface HostInput {
  /** Plugin options, as a user writes them in opencode.json. `path` is filled with the fake's own path. */
  readonly options?: Record<string, unknown>
  readonly config?: Record<string, unknown>
  readonly fake?: FakeScenario
  /** False for a scenario where the plugin is expected to register no server, such as a conflict. */
  readonly expectTools?: boolean
}

let hosts = 0

export async function startHost(input: HostInput = {}) {
  const base = join(root, `host-${++hosts}`)
  const work = join(base, "work")
  mkdirSync(work, { recursive: true })
  const fake = startFakeBinary(input.fake)
  const browse = createBrowsePlugin({ skillsDir, statusTimeoutMs: 5_000 })
  const withOptions = Plugin.define({ id: browse.id, setup: (ctx) => browse.setup({ ...ctx, options: { path: fake.path, ...(input.options ?? {}) } }) })
  const probes = new Map<string, Plugin.Context>()
  const probe = Plugin.define({ id: "browse.host-test.probe", setup: (ctx) => void probes.set(ctx.location.directory, ctx) })
  const config = {
    providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    ...(input.config ?? {}),
  }
  const { OpenCode } = (await import(pathToFileURL(join(SDK, "dist", "index.js")).href)) as typeof import("@opencode/sdk")
  const client: Client = await OpenCode.create({
    plugins: [withOptions, probe],
    app: { version: HOST_VERSION },
    config: { content: JSON.stringify(config), directory: join(base, "config"), project: false, claude: false },
    database: { path: join(base, "opencode.db") },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error" },
  })
  const location = { directory: work }
  const host = {
    client,
    location,
    fake,
    probe: () => {
      const ctx = probes.get(work)
      if (!ctx) throw new Error("the probe plugin has not loaded")
      return ctx
    },
    async close() {
      await client.close()
      if (offLoopback.length) throw new Error(`the host tried to leave loopback: ${[...new Set(offLoopback)].join(", ")}`)
    },
  }
  try {
    await until("the Browse plugin and the browse server are ready", async () => {
      const { data: plugins } = await client.plugin.list({ location })
      const state = plugins.find((plugin) => plugin.id === browse.id)?.state
      if (state?.status === "failed") throw new Error(`the Browse plugin failed: ${state.error}`)
      const { data: servers } = await client.mcp.list({ location })
      if (state?.status !== "active" || !probes.has(work)) return false
      if (input.expectTools === false) return true
      const connected = servers.some((server) => server.name === "browse" && server.status.status === "connected")
      if (!connected) return false
      // A local server connects first and lists its tools a moment later.
      return (await probes.get(work)!.tool.list()).some((tool) => tool.options?.namespace === "browse")
    })
  } catch (error) {
    await host.close().catch(() => {})
    throw error
  }
  return host
}

export type Host = Awaited<ReturnType<typeof startHost>>

/** Polls `check` until it returns a value. */
export async function until<T>(what: string, check: () => Promise<T | false | undefined>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    await Bun.sleep(50)
  }
}

export const session = async (host: Host, agent = "build") => (await host.client.sessions.create({ agent, location: host.location })).id

let calls = 0

/**
 * Runs a browse MCP tool through the host's own executor, which asserts `browse_<tool>` for the session's agent. A
 * prompt, if one appears, is answered with `decision`.
 */
export async function attempt(host: Host, sessionID: string, agent: string, tool: string, decision: "once" | "always" | "reject" = "reject", input: Record<string, unknown> = {}) {
  const executor = await until(`browse_${tool} is registered`, async () => (await host.probe().tool.list()).find((item) => item.id === `browse_${tool}`))
  const context = { sessionID, agent, messageID: "msg_host_test", id: `call_host_test_${++calls}`, signal: new AbortController().signal, progress: async () => {} }
  let settled = false
  const run = executor.execute(input, context as never).then(
    (result: unknown) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
  ).finally(() => (settled = true))
  let asked: string | undefined
  while (!settled) {
    const pending = await host.client.permission.list({ sessionID })
    const request = pending.find((item) => item.action === `browse_${tool}`)
    if (request) {
      asked = request.action
      await host.client.permission.reply({ sessionID, requestID: request.id, decision })
      break
    }
    await Promise.race([run, Bun.sleep(25)])
  }
  return { asked, ...(await run) }
}

/** The host's own last-match evaluation for an MCP call, which the model path, Code Mode and scripts all consult. */
export async function effect(host: Host, agent: string, action: string) {
  const sessionID = await session(host, agent)
  return (await host.client.permission.create({ sessionID, agent, action, resources: ["*"] })).effect
}

export const agentRules = async (host: Host) => new Map((await host.client.agent.list({ location: host.location })).data.map((agent) => [agent.id as string, agent.permissions as Rule[]]))
