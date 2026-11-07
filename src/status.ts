import type { Plugin, Rpc } from "@opencode/plugin"
import { PINNED_VERSION, PLUGIN_ID, SERVER_NAME, TESTED_HOSTS } from "./constants.js"
import { isSupportedHost, type HostCheck } from "./host-version.js"
import { TOOL_NAMES, effectOf, type Effect } from "./browse-tools.js"
import { defaultRules, unguardedAgents, type Rule, type RuleSet } from "./permissions.js"
import { shortReason } from "./redact.js"
import type { BrowseStatus } from "./engine.js"
import { VERSION } from "./version.js"

export { shortReason }

type State = "connected" | "connecting" | "failed" | "disabled" | "not_configured" | "conflict" | "host_untested"

export type ServerSource =
  | { readonly type: "plugin"; readonly command: string }
  | { readonly type: "adopted"; readonly command: string }
  | { readonly type: "conflict"; readonly command: string; readonly expected: string }

export interface BinaryFacts {
  readonly path: string | null
  readonly version: string | null
  readonly source: "package" | "option" | "environment" | null
  readonly verified: boolean
  /** True only for the release this plugin pins and ships. */
  readonly tested: boolean
  readonly supported: boolean
}

export interface RelayFacts {
  readonly running: boolean
  readonly version: string | null
  readonly stale: boolean
}

export interface ExtensionFacts {
  readonly connected: boolean
  readonly version: string | null
  readonly pairingState: string | null
  readonly compatible: boolean | null
  readonly nextStep: string | null
}

export interface ScopeFacts {
  readonly session: string
  readonly readOnly: boolean
  readonly allowedOrigins: readonly string[]
  /** True when the live session matches the configured scope. */
  readonly matches: boolean
}

const scopeMatches = (live: { readOnly: boolean; allowedOrigins: readonly string[] }, configured: { readOnly: boolean; allowedOrigins: readonly string[] }) =>
  live.readOnly === configured.readOnly &&
  JSON.stringify([...live.allowedOrigins].sort()) === JSON.stringify([...configured.allowedOrigins].sort())

/** What status is built from. The TUI fills what it can see; fields it cannot see stay undefined. */
export interface StatusFacts {
  readonly server?: { readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; readonly error?: string }
  readonly source?: ServerSource
  readonly host: HostCheck
  readonly rules: RuleSet
  readonly binary: BinaryFacts
  readonly binaryProblem?: string
  readonly probe?: { readonly version: string | null; readonly tested: boolean } | null
  readonly relay?: RelayFacts
  readonly extension?: ExtensionFacts
  readonly scope?: ScopeFacts
  readonly scopeProblem?: string
  readonly statusProblem?: string
  readonly tools?: readonly string[]
  readonly settling?: boolean
  readonly agents?: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]
  readonly problems?: readonly string[]
  readonly updates?: { readonly autoUpdate: string | null; readonly available: string | null }
}

export interface Status {
  readonly version: string
  readonly state: State
  readonly error?: string
  readonly source?: ServerSource
  readonly host: HostCheck
  readonly binary: BinaryFacts
  readonly relay: RelayFacts
  readonly extension: ExtensionFacts
  readonly scope?: ScopeFacts
  readonly tools: number
  readonly unknownCount: number
  readonly unknownTools: readonly string[]
  readonly unguardedAgents: readonly string[]
  readonly access: { readonly run: number; readonly ask: number; readonly off: number }
  readonly problems: readonly string[]
  readonly updates: { readonly autoUpdate: string | null; readonly available: string | null }
  readonly nextStep: string
}

const NOTHING_TO_DO = "Nothing to do."
const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`
const LISTED_UNKNOWN = 20
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/
const RULES_NOT_ADDED = "RULES_NOT_ADDED:"

const STATE_OF = { connected: "connected", pending: "connecting", failed: "failed", disabled: "disabled", needs_auth: "failed" } as const

/** The effect counts of the active rule set: what runs, what asks, what is off. */
export function accessCounts(set: RuleSet) {
  const rules = defaultRules(set)
  const counts: Record<Effect, number> = { allow: 0, ask: 0, deny: 0 }
  for (const tool of TOOL_NAMES) {
    // The last matching rule wins; `browse_*` is first, so a known tool's own rule decides.
    const effect = rules.findLast((rule) => rule.action === `${SERVER_NAME}_${tool}`)?.effect ?? effectOf(tool)
    counts[effect] += 1
  }
  return { run: counts.allow, ask: counts.ask, off: counts.deny }
}

export function buildStatus(facts: StatusFacts): Status {
  const conflict = facts.source?.type === "conflict"
  const binaryState: State | undefined = facts.binaryProblem
    ? /^BINARY_MISSING|^UNSUPPORTED_PLATFORM/.test(facts.binaryProblem)
      ? "not_configured"
      : "failed"
    : undefined
  const state: State = conflict
    ? "conflict"
    : facts.host.version === null || (!isSupportedHost(facts.host.version) && facts.host.tested === false && facts.server === undefined)
      ? "host_untested"
      : binaryState ?? (facts.server ? STATE_OF[facts.server.status] : "not_configured")
  const listed = facts.tools ?? []
  const unknown = listed.filter((tool) => !TOOL_NAMES.includes(tool))
  const probe = facts.probe
  const binary: BinaryFacts = {
    ...facts.binary,
    version: probe?.version ?? facts.binary.version,
    tested: probe?.tested ?? (facts.binary.source === "package" && facts.binary.version === PINNED_VERSION),
  }
  const status = {
    version: VERSION,
    state,
    ...(facts.server?.status === "failed" && facts.server.error ? { error: shortReason(facts.server.error) } : {}),
    ...(facts.source ? { source: facts.source } : {}),
    host: facts.host,
    binary,
    relay: facts.relay ?? { running: false, version: null, stale: false },
    extension: facts.extension ?? { connected: false, version: null, pairingState: null, compatible: null, nextStep: null },
    ...(facts.scope ? { scope: facts.scope } : {}),
    tools: listed.length,
    unknownCount: unknown.length,
    unknownTools: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN),
    unguardedAgents: unguardedAgents(facts.agents ?? []),
    access: accessCounts(facts.rules),
    problems: [...(facts.binaryProblem ? [facts.binaryProblem] : []), ...(facts.scopeProblem ? [facts.scopeProblem] : []), ...(facts.problems ?? [])],
    updates: facts.updates ?? { autoUpdate: null, available: null },
  }
  const known = unknown.length === 0 && listed.length > 0
  return { ...status, nextStep: nextStepOf(status, { known, settling: facts.settling === true, statusProblem: facts.statusProblem }) }
}

function nextStepOf(status: Omit<Status, "nextStep">, extra: { known: boolean; settling: boolean; statusProblem?: string }): string {
  switch (status.state) {
    case "conflict": {
      const source = status.source as Extract<ServerSource, { type: "conflict" }>
      return `Your OpenCode config defines mcp.servers.${SERVER_NAME} as ${source.command}, but this plugin registers the pinned binary. Remove that entry, then restart OpenCode, or set the plugin's "path" option to the binary you mean.`
    }
    case "host_untested":
      return `Use OpenCode ${TESTED_TEXT}, or set the plugin option "allowUntestedHost": true to run anyway.`
    case "not_configured":
      return status.problems.find((problem) => problem.startsWith("BINARY_MISSING") || problem.startsWith("UNSUPPORTED_PLATFORM"))?.split(" Next step: ")[1] ?? `The pinned browse binary is missing. Reinstall ${PLUGIN_NAME()} so its platform package is installed.`
    case "failed":
      return status.problems[0]?.split(" Next step: ")[1] ?? "Run /browse-doctor and fix the first failed check."
    case "disabled":
      return `The ${SERVER_NAME} MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
    case "connecting":
      return "Browse is still connecting. Run /browse-status again in a few seconds."
  }
  if (status.binary.source === "option" && status.binary.version !== null && !status.binary.tested) {
    return `The binary at ${status.binary.path} is browse ${status.binary.version}, not the pinned ${PINNED_VERSION}. Remove the "path" option to use the pinned release.`
  }
  if (!status.relay.running) return `The browse relay is not running. Ask the agent to open a page, or run \`browse status\` in a terminal.`
  if (!status.extension.connected) {
    if (status.extension.nextStep) return status.extension.nextStep
    return status.extension.pairingState === "unpaired"
      ? "Pair the browse extension: run `browse pair`, then enter the code on the extension's options page."
      : "Open the browser profile that is paired with browse; the extension reconnects by itself."
  }
  if (status.scope && !status.scope.matches) return "Run /browse-doctor to re-apply the configured scope to the pinned session."
  if (extra.settling) return "Browse is still listing its tools. Run /browse-status again in a few seconds."
  if (status.unknownCount > 0) {
    return `Browse lists ${status.unknownCount} tool(s) this plugin does not classify, so they are off. Update ${PLUGIN_NAME()} to a release that knows them, or allow one by exact name.`
  }
  const rules = status.problems.find((problem) => problem.startsWith(RULES_NOT_ADDED))
  if (rules) return rules.split(" Next step: ")[1] ?? "Restart OpenCode."
  if (status.unguardedAgents.length) {
    return `Put the default rules shown by /browse-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Browse tools.`
  }
  if (status.updates.available) return `browse ${status.updates.available} is available. Update this plugin to move to it; the pinned binary does not update itself.`
  if (extra.statusProblem) return `\`browse status\` did not answer: ${extra.statusProblem}. Run /browse-doctor.`
  return NOTHING_TO_DO
}

const PLUGIN_NAME = () => "@joe-broadhead/opencode-browse"

const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
  host_untested: "host untested",
}

const AGENT_RULES = defaultRules()
  .map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`)
  .join("\n")

function sourceText(source: ServerSource) {
  if (source.type === "plugin") return `${source.command}, registered by this plugin`
  if (source.type === "adopted") return `${source.command}, your own mcp.servers.${SERVER_NAME}, used with the pinned binary`
  return `your mcp.servers.${SERVER_NAME} points at ${source.command}`
}

function binaryText({ binary }: Status) {
  const { path, version, source, verified, tested } = binary
  if (path === null) return "none"
  const flags = [verified ? "verified" : "unverified", tested ? "pinned" : "untested"].join(", ")
  const origin = source === "option" ? "your path option" : source === "environment" ? "the test seam" : "the platform package"
  return `browse ${version ?? "unknown version"} (${flags}; ${origin}) · ${path}`
}

function extensionText({ extension }: Status) {
  if (extension.connected) return `paired and connected${extension.version ? ` · ${extension.version}` : ""}${extension.compatible === false ? " · protocol incompatible" : ""}`
  if (extension.pairingState === "unpaired") return "not paired"
  if (extension.pairingState) return `not connected (${extension.pairingState})`
  return "not connected"
}

function relayText({ relay }: Status) {
  if (!relay.running) return "stopped"
  return `running${relay.version ? ` · ${relay.version}` : ""}${relay.stale ? " · stale build" : ""}`
}

function accessText({ access }: Status) {
  return `${access.run} run · ${access.ask} ask · ${access.off} off`
}

function toolsText({ tools, unknownCount, unknownTools }: Status) {
  if (unknownCount === 0) return `${tools} available, 0 unknown`
  const more = unknownCount - unknownTools.length
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  return `${tools} available, ${unknownCount} unknown${names} (unknown tools are off)`
}

export function formatStatus(status: Status) {
  const scope = status.scope
    ? `Scope: ${status.scope.session}${status.scope.readOnly ? " (read-only)" : ""}${status.scope.allowedOrigins.length ? ` · ${status.scope.allowedOrigins.join(", ")}` : " · no allowlist"}${status.scope.matches ? "" : " · drifted"}`
    : undefined
  const details = [status.error, status.source && sourceText(status.source)].filter(Boolean).join("; ")
  return [
    "Browse status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Access: ${accessText(status)}`,
    `- Browser: ${binaryText(status)}`,
    `- Relay: ${relayText(status)}`,
    `- Extension: ${extensionText(status)}`,
    ...(scope ? [`- ${scope}`] : []),
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${status.unguardedAgents.length ? `${status.unguardedAgents.join(", ")}\n${AGENT_RULES}` : "none"}`,
    `- OpenCode: ${status.host.version ?? "unknown version"} (${status.host.tested ? "tested" : "untested"}; supported range ${status.host.range})${status.problems.filter((p) => !p.startsWith("RULES_NOT_ADDED")).length ? `. ${status.problems.filter((p) => !p.startsWith("RULES_NOT_ADDED")).join(" ")}` : ""}`,
    `- Next step: ${status.nextStep}`,
  ].join("\n")
}

export interface StatusContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly agent: Pick<Plugin.Context["agent"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
}

/** How long after a status change no tools still means "listing". */
const LISTING_MS = 15_000
interface ListingState {
  readonly changedAt: () => number
}

/**
 * Reads the live facts through public host APIs, plus the engine's cached `browse status --json`. Never drives the
 * browser: the status command is observational and starts nothing.
 */
export async function readStatus(
  ctx: StatusContext,
  facts: Pick<StatusFacts, "source" | "host" | "rules" | "binary" | "binaryProblem" | "probe" | "scope" | "scopeProblem" | "problems"> & {
    readonly live: () => Promise<{ status?: BrowseStatus; reason?: string }>
    readonly listing?: ListingState
  },
) {
  const [servers, agents, tools] = await Promise.all([ctx.mcp.list(), ctx.agent.list(), ctx.tool.list()])
  const server = servers.data.find((entry) => entry.name === SERVER_NAME)
  const { live, listing, ...rest } = facts
  const liveResult = await live()
  const status = liveResult.status
  const scopeSession = rest.scope
  const liveScope = status && scopeSession ? status.sessions.find((entry) => entry.id === scopeSession.session) : undefined
  const settling = listing !== undefined && Date.now() - listing.changedAt() < LISTING_MS
  return buildStatus({
    ...rest,
    ...(server ? { server: server.status } : {}),
    ...(status
      ? {
          relay: status.relay,
          extension: {
            connected: status.extension.connected,
            version: status.extension.version,
            pairingState: status.extension.pairingState,
            compatible: status.extension.protocolCompatible,
            nextStep: status.extension.nextStep,
          },
          updates: { autoUpdate: status.autoUpdate, available: status.updateAvailable },
        }
      : {}),
    ...(scopeSession
      ? {
          scope: {
            session: scopeSession.session,
            readOnly: scopeSession.readOnly,
            allowedOrigins: scopeSession.allowedOrigins,
            matches:
              liveScope !== undefined &&
              liveScope.readOnly === scopeSession.readOnly &&
              JSON.stringify([...liveScope.allowedOrigins].sort()) === JSON.stringify([...scopeSession.allowedOrigins].sort()),
          },
        }
      : {}),
    ...(liveResult.reason ? { statusProblem: shortReason(liveResult.reason) } : {}),
    ...(scopeSession && status !== undefined && (liveScope === undefined || !scopeMatches(liveScope, scopeSession))
      ? { scopeProblem: `SCOPE_LOST: Session "${scopeSession.session}" is missing or no longer has the configured scope. Next step: Run /browse-doctor to re-apply it.` }
      : {}),
    tools: tools.filter((tool) => tool.options?.namespace === SERVER_NAME).map((tool) => tool.name),
    settling,
    agents: agents.data,
  })
}

function unavailable(error: unknown) {
  const reason = shortReason(error instanceof Error ? error.message : String(error))
  return {
    message: `STATUS_UNAVAILABLE: Could not read Browse's status${reason ? ` (${reason})` : ""}.`,
    nextStep: "Restart OpenCode, then run /browse-status again.",
  }
}

const strings = { type: "array", items: { type: "string" } }
const count = { type: "integer", minimum: 0 }
const nullableString = { type: ["string", "null"] }
const nullableBoolean = { type: ["boolean", "null"] }

export const StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "state", "host", "binary", "relay", "extension", "tools", "unknownCount", "unknownTools", "unguardedAgents", "access", "problems", "updates", "nextStep"],
        properties: {
          version: { type: "string" },
          state: { enum: ["connected", "connecting", "failed", "disabled", "not_configured", "conflict", "host_untested"] },
          error: { type: "string" },
          source: {
            type: "object",
            required: ["type"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, command: { type: "string" }, expected: { type: "string" } },
          },
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } },
          },
          binary: {
            type: "object",
            required: ["path", "version", "source", "verified", "tested", "supported"],
            properties: {
              path: nullableString,
              version: nullableString,
              source: { enum: ["package", "option", "environment", null] },
              verified: { type: "boolean" },
              tested: { type: "boolean" },
              supported: { type: "boolean" },
            },
          },
          relay: {
            type: "object",
            required: ["running", "version", "stale"],
            properties: { running: { type: "boolean" }, version: nullableString, stale: { type: "boolean" } },
          },
          extension: {
            type: "object",
            required: ["connected", "version", "pairingState", "compatible", "nextStep"],
            properties: { connected: { type: "boolean" }, version: nullableString, pairingState: nullableString, compatible: nullableBoolean, nextStep: nullableString },
          },
          scope: {
            type: "object",
            required: ["session", "readOnly", "allowedOrigins", "matches"],
            properties: { session: { type: "string" }, readOnly: { type: "boolean" }, allowedOrigins: strings, matches: { type: "boolean" } },
          },
          tools: count,
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          access: {
            type: "object",
            required: ["run", "ask", "off"],
            properties: { run: count, ask: count, off: count },
          },
          problems: strings,
          updates: {
            type: "object",
            required: ["autoUpdate", "available"],
            properties: { autoUpdate: nullableString, available: nullableString },
          },
          nextStep: { type: "string" },
        },
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export function registerStatusRpc(rpc: Pick<Plugin.Context["rpc"], "register">, read: () => Promise<Status>) {
  return rpc.register(StatusRpc, {
    status: (_input, { error }) =>
      read().catch((cause: unknown) => {
        const { message, nextStep } = unavailable(cause)
        return error("unavailable", message, { nextStep })
      }),
  })
}

export function registerStatusCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic"> },
  read: () => Promise<Status>,
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "browse-status",
      description: "Show Browse's binary, relay, extension, scope, tools and the next step",
      execute: async ({ sessionID }) => {
        const text = await read().then(formatStatus, (cause: unknown) => {
          const { message, nextStep } = unavailable(cause)
          return `${message} Next step: ${nextStep}`
        })
        await ctx.session.synthetic({ sessionID, text, description: "Browse status", resume: false })
      },
    }),
  )
}
