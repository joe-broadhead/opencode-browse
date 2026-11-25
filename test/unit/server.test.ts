// The `browse` MCP server registration: the plugin's own entry, the adoption of a person's browse entry, the conflict
// that denies a stranger's entry, and the older vendor server name that is denied rather than run alongside.
import { describe, expect, test } from "bun:test"
import { registerServer, type ServerSource } from "../../src/provider/server.js"

interface Entry {
  type?: string
  command?: string[]
  environment?: Record<string, string>
}

const WANTED = ["/pkg/bin/mcp.mjs", "--pinned", "abc", "/pkg/browse", "mcp"]
const WANTED_ENV = { OPENCODE_BROWSER_MCP_DIRECT: "1", OPENCODE_BROWSER_AUTO_UPDATE: "off" }

/** A fake editor over a config record, with the transform `registerServer` uses. */
function fakeMcp(entries: Record<string, Entry>) {
  const configs: Record<string, Entry> = { ...entries }
  const mcp = {
    transform: async (callback: (editor: unknown) => void) => {
      callback({
        get: (name: string) => configs[name],
        set: (name: string, config: Entry) => void (configs[name] = config),
        update: (name: string, update: (config: Entry) => void) => void (configs[name] !== undefined && update(configs[name]!)),
      })
      return { dispose: async () => undefined }
    },
  }
  return { mcp: mcp as never, configs }
}

function run(entries: Record<string, Entry>, entry: { command: string[]; environment: Record<string, string> } | null = { command: WANTED, environment: WANTED_ENV }) {
  const { mcp, configs } = fakeMcp(entries)
  const seen: { source?: ServerSource; problem?: string } = {}
  registerServer(mcp, entry ?? undefined, (source, problem) => {
    seen.source = source
    seen.problem = problem
  })
  return { configs, seen }
}

describe("registerServer", () => {
  test("registers the plugin's wrapper when the person has no browse entry", () => {
    const { configs, seen } = run({})
    expect(configs["browse"]).toEqual({ type: "local", command: WANTED, environment: WANTED_ENV })
    expect(seen.source).toEqual({ type: "plugin", command: WANTED.join(" ") })
    expect(seen.problem).toBeUndefined()
  })

  test("adopts the person's own browse entry, replacing its command and pinning its environment", () => {
    const { configs, seen } = run(
      { browse: { type: "local", command: ["/usr/local/bin/browse", "mcp"], environment: { KEEP: "1", OPENCODE_BROWSER_SESSION: "old" } } },
      { command: WANTED, environment: WANTED_ENV },
    )
    expect(configs["browse"]?.command).toEqual(WANTED)
    expect(configs["browse"]?.environment).toEqual({ KEEP: "1", ...WANTED_ENV })
    expect(seen.source?.type).toBe("adopted")
  })

  test("a stranger's browse entry is a conflict and is left untouched", () => {
    const { configs, seen } = run({ browse: { type: "local", command: ["node", "/somewhere/else/mcp.js"] } })
    expect(configs["browse"]?.command).toEqual(["node", "/somewhere/else/mcp.js"])
    expect(seen.source).toMatchObject({ type: "conflict" })
  })

  test("a remote browse entry is a conflict", () => {
    const { seen } = run({ browse: { type: "remote" } })
    expect(seen.source).toMatchObject({ type: "conflict", command: "remote" })
  })

  test("an older vendor server name is reported, and the plugin's entry is still registered", () => {
    const { configs, seen } = run({ "opencode-browser": { type: "local", command: ["browse", "mcp"] } })
    expect(configs["browse"]).toBeDefined()
    expect(seen.problem?.startsWith("SERVER_LEGACY: ")).toBe(true)
  })

  test("an older vendor server name alone is reported and nothing is registered", () => {
    const { configs, seen } = run({ "opencode-browser": { type: "local", command: ["browse", "mcp"] } }, null)
    expect(configs["browse"]).toBeUndefined()
    expect(seen.source).toBeUndefined()
    expect(seen.problem?.startsWith("SERVER_LEGACY: ")).toBe(true)
  })
})
