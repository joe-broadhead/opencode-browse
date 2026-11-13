import type { Plugin, Rpc } from "@opencode/plugin"
import { errorText, PINNED_VERSION, PLUGIN_ID, SERVER_NAME, TESTED_HOSTS } from "./constants.js"
import { isSupportedHost, type HostCheck } from "./host-version.js"
import { TOOL_NAMES, type Access, type Effect } from "./browse-tools.js"
import { conflictRules, defaultRules, evaluate, unguardedAgents, type Rule, type RuleSet } from "./permissions.js"
import { shortReason } from "./redact.js"
import type { BrowseStatus } from "./engine.js"
import type { ManagedStatus } from "./managed/browser.js"
import { formatRecording, recordingNextStep, type RecordingReadiness } from "./recording.js"
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
  /** True when the live session matches the configured scope; false when it is missing, differs, or cannot be read. */
  readonly matches: boolean
}

/** What status is built from. The TUI fills what it can see; fields it cannot see stay undefined. */
export interface StatusFacts {
  readonly server?: { readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; readonly error?: string }
  readonly source?: ServerSource
  readonly host: HostCheck
  readonly rules: RuleSet
  readonly binary: BinaryFacts
  readonly binaryProblem?: string
  /** Option or host validation failed, or the plugin could not start: the model is status-only. */
  readonly fatal?: string
  readonly probe?: { readonly version: string | null; readonly tested: boolean } | null
  readonly relay?: RelayFacts
  readonly extension?: ExtensionFacts
  readonly scope?: ScopeFacts
  readonly scopeProblem?: string
  readonly statusProblem?: string
  readonly legacy?: boolean
  readonly mode: "real" | "managed"
  readonly managed?: ManagedStatus
  readonly recording?: RecordingReadiness
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
  readonly mode: "real" | "managed"
  readonly managed?: ManagedStatus
  readonly recording?: RecordingReadiness
  readonly legacy: boolean
  readonly tools: number
  readonly unknownCount: number
  readonly unknownTools: readonly string[]
  readonly unguardedAgents: readonly string[]
  readonly access: { readonly run: number; readonly ask: number; readonly off: number }
  /** The access option in force, which the dialog's Access row names. */
  readonly accessMode: Access
  readonly problems: readonly string[]
  readonly updates: { readonly autoUpdate: string | null; readonly available: string | null }
  readonly nextStep: string
}

const NOTHING_TO_DO = "Nothing to do."
const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`
const LISTED_UNKNOWN = 20
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/
const RULES_NOT_ADDED = "RULES_NOT_ADDED:"
const PLUGIN_NAME = "github:joe-broadhead/opencode-browse#v0.0.1"

const STATE_OF = { connected: "connected", pending: "connecting", failed: "failed", disabled: "disabled", needs_auth: "failed" } as const

/** The effect counts of the active rule set: what runs, what asks, what is off. */
export function accessCounts(set: RuleSet, conflict = false) {
  const rules = conflict ? conflictRules() : defaultRules(set)
  const counts: Record<Effect, number> = { allow: 0, ask: 0, deny: 0 }
  for (const tool of TOOL_NAMES) counts[evaluate(rules, `${SERVER_NAME}_${tool}`)] += 1
  return { run: counts.allow, ask: counts.ask, off: counts.deny }
}

/** The block to paste into an agent: the active profile's, never another's. */
export function agentRules(set: RuleSet, conflict = false): string {
  return (conflict ? conflictRules() : defaultRules(set))
    .map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`)
    .join("\n")
}

const scopeMatches = (live: { readOnly: boolean; allowedOrigins: readonly string[] }, configured: { readOnly: boolean; allowedOrigins: readonly string[] }) =>
  live.readOnly === configured.readOnly && JSON.stringify([...live.allowedOrigins].sort()) === JSON.stringify([...configured.allowedOrigins].sort())

export function buildStatus(facts: StatusFacts): Status {
  const conflict = facts.source?.type === "conflict"
  const fatalCode = facts.fatal?.split(":")[0]
  const binaryState: State | undefined = facts.binaryProblem
    ? /^BINARY_MISSING|^UNSUPPORTED_PLATFORM/.test(facts.binaryProblem)
      ? "not_configured"
      : "failed"
    : undefined
  const hostOutside = facts.host.version === null || !isSupportedHost(facts.host.version)
  const state: State =
    fatalCode === "HOST_UNTESTED"
      ? "host_untested"
      : facts.fatal !== undefined
        ? "failed"
        : conflict
          ? "conflict"
          : hostOutside && facts.server === undefined
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
    mode: facts.mode,
    ...(facts.managed ? { managed: facts.managed } : {}),
    ...(facts.recording ? { recording: facts.recording } : {}),
    legacy: facts.legacy === true,
    tools: listed.length,
    unknownCount: unknown.length,
    unknownTools: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN),
    unguardedAgents: unguardedAgents(facts.agents ?? []),
    access: accessCounts(facts.rules, conflict === true),
    accessMode: facts.rules.access ?? "all",
    problems: [...(facts.fatal ? [facts.fatal] : []), ...(facts.binaryProblem ? [facts.binaryProblem] : []), ...(facts.scopeProblem ? [facts.scopeProblem] : []), ...(facts.problems ?? [])],
    updates: facts.updates ?? { autoUpdate: null, available: null },
  }
  const known = unknown.length === 0 && listed.length > 0
  return { ...status, nextStep: nextStepOf(status, { known, settling: facts.settling === true, statusProblem: facts.statusProblem }) }
}

function nextStepOf(status: Omit<Status, "nextStep">, extra: { known: boolean; settling: boolean; statusProblem?: string }): string {
  const fatal = status.problems.find((problem) => problem.startsWith("OPTIONS_INVALID") || problem.startsWith("HOST_UNTESTED"))
  if (fatal) return fatal.split(" Next step: ")[1] ?? "Fix the plugin options, then restart OpenCode."
  if (status.state === "conflict") {
    const source = status.source as Extract<ServerSource, { type: "conflict" }>
    return `Your OpenCode config defines mcp.servers.${SERVER_NAME} as ${source.command}, but this plugin registers the pinned binary. Every tool of that server is denied; remove the entry, then restart OpenCode, or set the plugin's "path" option to the binary you mean.`
  }
  if (status.legacy) {
    return `An older "opencode-browser" MCP server is still configured, and its tools are denied by this plugin. Remove that entry from opencode.json, then restart OpenCode.`
  }
  if (status.state === "host_untested") return `Use OpenCode ${TESTED_TEXT}, or set the plugin option "allowUntestedHost": true to run anyway.`
  if (status.state === "not_configured") {
    return status.problems.find((problem) => problem.startsWith("BINARY_MISSING") || problem.startsWith("UNSUPPORTED_PLATFORM"))?.split(" Next step: ")[1] ?? "Run /browse-install, then restart OpenCode."
  }
  if (status.state === "failed") return status.problems[0]?.split(" Next step: ")[1] ?? "Run /browse-doctor and fix the first failed check."
  if (status.state === "disabled") return `The ${SERVER_NAME} MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
  if (status.state === "connecting") return "Browse is still connecting. Run /browse-status again in a few seconds."
  if (status.binary.source === "option" && status.binary.version !== null && !status.binary.tested) {
    return `The binary at ${status.binary.path} is browse ${status.binary.version}, not the pinned ${PINNED_VERSION}. Remove the "path" option to use the pinned release.`
  }
  if (status.mode === "managed") {
    const managed = status.managed
    if (managed?.state === "not_installed") {
      return `Managed mode needs Chrome for Testing ${managed.chromiumPin?.version ?? ""}. Run /browse-install-browser to download and verify it (about ${Math.round((managed.chromiumPin?.bytes ?? 0) / 1_000_000)} MB), or set "chromiumPath".`
    }
    if (managed?.state === "failed") return `The managed browser failed: ${managed.lastError ?? "see the browser log"}. Run /browse-doctor.`
    if (managed?.state === "starting") return "The managed browser is starting. Run /browse-status again in a few seconds."
    if (managed?.state === "running" && managed.chromium.source === "option" && !managed.chromium.verified) {
      return `The managed browser at ${managed.chromium.path} is your own Chromium ${managed.chromium.version}; its digest is not pinned. Remove "chromiumPath" to use the pinned Chrome for Testing.`
    }
  }
  const relayProblem = status.problems.find((problem) => problem.startsWith("RELAY_FAILED"))
  if (relayProblem) return relayProblem.split(" Next step: ")[1] ?? "Run /browse-doctor."
  if (!status.relay.running) return `The browse relay is not running. Ask the agent to open a page, or run \`browse status\` in a terminal.`
  if (!status.extension.connected) {
    if (status.extension.nextStep) return status.extension.nextStep
    return status.mode === "managed"
      ? "The managed browser is running but not paired. Run /browse-doctor; if it persists, delete the managed profile or run /browse-status for the next step."
      : "Pair the browse extension: run the `Pair:` command /browse-doctor prints, then enter the code on the extension's options page."
  }
  if (status.scope && !status.scope.matches) return "Run /browse-doctor to re-apply the configured scope to the pinned session."
  if (extra.settling) return "Browse is still listing its tools. Run /browse-status again in a few seconds."
  if (status.unknownCount > 0) {
    return `Browse lists ${status.unknownCount} tool(s) this plugin does not classify. They follow the access option, like every tool. Update ${PLUGIN_NAME} to a release that knows them, or set a rule for one by exact name.`
  }
  if (status.problems.some((problem) => problem.startsWith(RULES_NOT_ADDED))) return status.problems.find((problem) => problem.startsWith(RULES_NOT_ADDED))!.split(" Next step: ")[1] ?? "Restart OpenCode."
  if (status.unguardedAgents.length) {
    return `Put the default rules shown by /browse-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Browse tools.`
  }
  const recording = recordingNextStep(status.recording)
  if (recording) return recording
  if (status.updates.available) return `browse ${status.updates.available} is available. Update this plugin to move to it; the pinned binary does not update itself.`
  if (extra.statusProblem) return `\`browse status\` did not answer: ${extra.statusProblem}. Run /browse-doctor.`
  return NOTHING_TO_DO
}

const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
  host_untested: "host untested",
}

function sourceText(source: ServerSource) {
  if (source.type === "plugin") return `${source.command}, registered by this plugin`
  if (source.type === "adopted") return `${source.command}, your own mcp.servers.${SERVER_NAME}, used with the pinned binary`
  return `your mcp.servers.${SERVER_NAME} points at ${source.command}`
}

function binaryText({ binary }: Status) {
  const { path, version, source, verified, tested } = binary
  if (path === null) return "none"
  const flags = [verified ? "verified at startup" : "unverified", tested ? "pinned" : "untested"].join(", ")
  const origin = source === "option" ? "your path option" : source === "environment" ? "the test seam" : "the release"
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
  return `running${relay.version ? ` · ${relay.version}` : ""}${relay.stale ? " · stale build" : ""} · auto-update off`
}

function managedText({ managed }: Status) {
  if (managed === undefined) return undefined
  const chromium = managed.chromium.path === null
    ? `none${managed.chromiumPin ? ` (pinned Chrome for Testing ${managed.chromiumPin.version}${managed.chromiumPin.supported ? "" : ", no build for this platform"})` : ""}`
    : `Chrome for Testing ${managed.chromium.version} (${managed.chromium.verified ? "verified" : "unverified, your own"}; ${managed.chromium.source}) · ${managed.chromium.path}`
  const running = managed.state === "running" && managed.pid !== null ? ` · pid ${managed.pid}${managed.headless ? " · headless" : " · headed"}` : ""
  return `${managed.state}${running} · extension ${managed.extension.version ?? "unknown"} · ${chromium}`
}

const ACCESS_TEXT = (status: Status) => `${status.access.run} run · ${status.access.ask} ask · ${status.access.off} off; option access is "${status.accessMode}"`

function toolsText({ tools, unknownCount, unknownTools }: Status) {
  if (unknownCount === 0) return `${tools} available, 0 unknown`
  const more = unknownCount - unknownTools.length
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  return `${tools} available, ${unknownCount} unknown${names} (an unknown tool runs on the \`browse_*\` rule)`
}

export function formatStatus(status: Status) {
  const scope = status.scope
    ? `Scope: ${status.scope.session}${status.scope.readOnly ? " (read-only)" : ""}${status.scope.allowedOrigins.length ? ` · ${status.scope.allowedOrigins.join(", ")}` : " · no allowlist"}${status.scope.matches ? "" : " · drifted or unknown"}`
    : undefined
  const managed = managedText(status)
  const details = [status.error, status.source && sourceText(status.source), status.legacy ? "an older opencode-browser server is configured and denied" : undefined].filter(Boolean).join("; ")
  return [
    "Browse status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Mode: ${status.mode === "managed" ? "managed browser" : "real browser (the Web Store extension)"}`,
    `- Access: ${ACCESS_TEXT(status)}`,
    `- Browser: ${binaryText(status)}`,
    ...(managed ? [`- Managed: ${managed}`] : []),
    `- Relay: ${relayText(status)}`,
    `- Extension: ${extensionText(status)}`,
    `- Recording: ${formatRecording(status.recording)}`,
    ...(scope ? [`- ${scope}`] : []),
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${status.unguardedAgents.length ? `${status.unguardedAgents.join(", ")}\n${agentRules({ access: status.accessMode, scoped: status.scope !== undefined, readOnly: status.scope?.readOnly === true }, status.state === "conflict")}` : "none"}`,
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
 * Reads the live facts through public host APIs, plus the engine's cached `browse status --json` and the managed
 * browser's state. Never drives the browser: the status command is observational and starts nothing.
 */
export async function readStatus(
  ctx: StatusContext,
  facts: Pick<StatusFacts, "source" | "host" | "rules" | "binary" | "binaryProblem" | "fatal" | "probe" | "scope" | "scopeProblem" | "problems" | "mode" | "legacy"> & {
    readonly live: () => Promise<{ status?: BrowseStatus; reason?: string }>
    readonly managed?: () => ManagedStatus | undefined
    readonly listing?: ListingState
  },
) {
  const [servers, agents, tools] = await Promise.all([ctx.mcp.list(), ctx.agent.list(), ctx.tool.list()])
  const server = servers.data.find((entry) => entry.name === SERVER_NAME)
  const legacy = servers.data.some((entry) => entry.name === "opencode-browser")
  const { live, listing, managed, ...rest } = facts
  const liveResult = await live()
  const status = liveResult.status
  const scopeSession = rest.scope
  const liveScope = status && scopeSession ? status.sessions.find((entry) => entry.id === scopeSession.session) : undefined
  const settling = listing !== undefined && Date.now() - listing.changedAt() < LISTING_MS
  return buildStatus({
    ...rest,
    ...(server ? { server: server.status } : {}),
    legacy: rest.legacy === true || legacy,
    ...(managed?.() ? { managed: managed() } : {}),
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
            matches: liveScope !== undefined && scopeMatches(liveScope, scopeSession),
          },
        }
      : {}),
    ...(status?.relayError
      ? { statusProblem: shortReason(status.relayError), problems: [...(rest.problems ?? []), errorText("RELAY_FAILED", `The browse relay reported an error (${shortReason(status.relayError)}).`, "Run /browse-doctor.")] }
      : liveResult.reason
        ? { statusProblem: shortReason(liveResult.reason) }
        : {}),
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
        required: ["version", "state", "mode", "legacy", "host", "binary", "relay", "extension", "tools", "unknownCount", "unknownTools", "unguardedAgents", "access", "problems", "updates", "nextStep"],
        properties: {
          version: { type: "string" },
          state: { enum: ["connected", "connecting", "failed", "disabled", "not_configured", "conflict", "host_untested"] },
          mode: { enum: ["real", "managed"] },
          legacy: { type: "boolean" },
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
          recording: {
            type: "object",
            required: ["ffmpeg", "toolbar"],
            properties: {
              ffmpeg: {
                type: "object",
                required: ["found", "path", "version"],
                properties: { found: { type: "boolean" }, path: nullableString, version: nullableString },
              },
              toolbar: { type: "object", required: ["ready"], properties: { ready: { type: "boolean" } } },
            },
          },
          managed: {
            type: "object",
            required: ["state", "chromium", "extension", "profile", "pid", "headless", "lastError"],
            properties: {
              state: { enum: ["stopped", "starting", "running", "not_installed", "failed"] },
              chromium: {
                type: "object",
                required: ["path", "version", "source", "verified"],
                properties: { path: nullableString, version: nullableString, source: { enum: ["installed", "option", null] }, verified: { type: "boolean" } },
              },
              chromiumPin: {
                type: "object",
                required: ["version", "supported"],
                properties: { version: { type: "string" }, supported: { type: "boolean" }, bytes: { type: "integer", minimum: 0 } },
              },
              extension: {
                type: "object",
                required: ["version", "directory"],
                properties: { version: nullableString, directory: nullableString },
              },
              profile: { type: "string" },
              pid: { type: ["integer", "null"] },
              headless: { type: "boolean" },
              lastError: nullableString,
            },
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
      description: "Show Browse's mode, binary, relay, extension, scope, tools and the next step",
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
