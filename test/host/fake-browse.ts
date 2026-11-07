// A fake browse binary in its own temp folder: the script, a config beside it, and a calls log. The plugin resolves it
// through the `path` option, so nothing here touches the pinned 115 MB binary, a relay, a browser or an extension.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ROOT } from "./isolate.js"

const source = fileURLToPath(new URL("./fake-browse.mjs", import.meta.url))
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/live-tools.json", import.meta.url)), "utf8")) as {
  tools: { name: string; description: string; inputSchema: unknown; annotations: Record<string, unknown> }[]
}

/** The 18 real tools, as the fake's `tools/list` answers them. */
export const REAL_TOOLS = fixture.tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: tool.annotations,
}))

/** A tool browse adds later: in the list, not in the plugin's table, so it must be off. */
export const NEW_TOOL = {
  name: "shiny_new_tool",
  description: "A tool added upstream after this plugin's table was written",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}

export interface FakeScenario {
  readonly version?: string
  readonly tools?: readonly unknown[]
  readonly status?: unknown
  readonly statusExit?: number
  readonly statusReason?: string
  readonly doctor?: unknown
  readonly doctorExit?: number
  readonly sessions?: readonly unknown[]
}

export interface FakeBinary {
  readonly path: string
  readonly dir: string
  /** Every call the fake saw, oldest first. */
  calls(): { kind: string; tool?: string; command?: string; input?: unknown }[]
  /** Replaces the config the fake reads on its next invocation. */
  configure(scenario: FakeScenario): void
  /** The calls of one kind, such as the tools it was asked to run. */
  tools(): string[]
}

let count = 0

export function startFakeBinary(scenario: FakeScenario = {}): FakeBinary {
  const dir = join(ROOT, `fake-browse-${++count}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "browse")
  copyFileSync(source, path)
  chmodSync(path, 0o755)
  const write = (next: FakeScenario) =>
    writeFileSync(
      join(dir, "fake-browse.json"),
      `${JSON.stringify(
        {
          version: next.version ?? "0.0.14",
          tools: next.tools ?? REAL_TOOLS,
          sessions: next.sessions ?? [],
          current: undefined,
          ...(next.status === undefined ? {} : { status: next.status }),
          ...(next.statusExit === undefined ? {} : { statusExit: next.statusExit }),
          ...(next.statusReason === undefined ? {} : { statusReason: next.statusReason }),
          ...(next.doctor === undefined ? {} : { doctor: next.doctor }),
          ...(next.doctorExit === undefined ? {} : { doctorExit: next.doctorExit }),
        },
        null,
        2,
      )}\n`,
    )
  write(scenario)
  const calls = () => {
    try {
      return readFileSync(join(dir, "calls.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kind: string; tool?: string; command?: string; input?: unknown })
    } catch {
      return []
    }
  }
  return {
    path,
    dir,
    calls,
    configure: write,
    tools: () => calls().filter((call) => call.kind === "tool").map((call) => call.tool ?? ""),
  }
}
