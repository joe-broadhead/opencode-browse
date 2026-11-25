// The report's builder: the facts setup resolved, the live host reads and the manifest's own access rules. This module
// is in the server half only; the terminal UI imports report.ts, which describes and prints what this builds.
import type { Plugin } from "@opencode/plugin"
import { effectFor, rulesFor, type PermissionRule } from "@we-the-rebel-alliance/plugin-contract/access"
import { hostInRange, type Manifest, type MethodItem } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { errorText, PINNED_VERSION, SERVER_NAME } from "./constants.js"
import type { BrowseStatus } from "./provider/binary.js"
import type { ManagedStatus } from "./provider/managed.js"
import { recordingNextStep } from "./provider/recording.js"
import type { BinaryFacts, Report, ReportFacts, HostCheck, AccessLevel, State } from "./report.js"
import { shortReason } from "./redact.js"
import type { ServerSource } from "./provider/server.js"
import { VERSION } from "./version.js"

export type { AccessLevel } from "./report.js"

const NOTHING_TO_DO = "Nothing to do."
const LISTED_UNKNOWN = 20
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/
const PLUGIN_NAME = "github:we-the-rebel-alliance/browse-plugin"

const STATE_OF = { connected: "connected", pending: "connecting", failed: "failed", disabled: "disabled", needs_auth: "failed" } as const

/** The manifest's pass-through tools, by upstream name. */
export const toolNames = (manifest: Manifest): readonly string[] =>
  Object.keys(manifest.methods).filter((method) => method.startsWith("mcp:")).map((method) => method.slice("mcp:".length))

/** The effect counts of the generated rules: what runs, what asks, what is off, for the pass-through tools. */
export function accessCounts(manifest: Manifest, level: AccessLevel) {
  const counts = { run: 0, ask: 0, off: 0 }
  for (const method of toolNames(manifest)) {
    const item = manifest.methods[`mcp:${method}`] as MethodItem
    const effect = effectFor(item, level)
    if (effect === "allow") counts.run += 1
    else if (effect === "ask") counts.ask += 1
    else counts.off += 1
  }
  return counts
}

/** The block to paste into an agent that lacks the generated rules: the contract's own rules, never a copy. */
export function agentRules(manifest: Manifest, level: AccessLevel): string {
  const rules: readonly PermissionRule[] = rulesFor(manifest, level)
  return rules.map((rule, index) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
}

const scopeMatches = (live: { readOnly: boolean; allowedOrigins: readonly string[] }, configured: { readOnly: boolean; allowedOrigins: readonly string[] }) =>
  live.readOnly === configured.readOnly && JSON.stringify([...live.allowedOrigins].sort()) === JSON.stringify([...configured.allowedOrigins].sort())

export function buildReport(manifest: Manifest, facts: ReportFacts): Report {
  const conflict = facts.source?.type === "conflict"
  const fatalCode = facts.fatal?.split(":")[0]
  const binaryState: State | undefined = facts.binaryProblem
    ? /^BINARY_MISSING|^UNSUPPORTED_PLATFORM/.test(facts.binaryProblem)
      ? "not_configured"
      : "failed"
    : undefined
  const hostOutside = facts.host.version === null || !hostInRange(facts.host.version)
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
  const known = new Set(toolNames(manifest))
  const unknown = listed.filter((tool) => !known.has(tool))
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
    unguardedAgents: [...facts.unguardedAgents],
    access: accessCounts(manifest, facts.level),
    accessMode: facts.level,
    problems: [...new Set([...(facts.fatal ? [facts.fatal] : []), ...(facts.binaryProblem ? [facts.binaryProblem] : []), ...(facts.scopeProblem ? [facts.scopeProblem] : []), ...(facts.problems ?? [])])],
    updates: facts.updates ?? { autoUpdate: null, available: null },
  }
  return { ...status, nextStep: nextStepOf(manifest, status, { settling: facts.settling === true, statusProblem: facts.statusProblem }) }
}

/** The host versions a next step names: the tested list from the manifest. */
const testedText = (manifest: Manifest) =>
  manifest.plugin.host.tested.length === 1 ? manifest.plugin.host.tested[0]! : `${manifest.plugin.host.tested.slice(0, -1).join(", ")} or ${manifest.plugin.host.tested.at(-1)}`

function nextStepOf(manifest: Manifest, status: Omit<Report, "nextStep">, extra: { settling: boolean; statusProblem?: string }): string {
  const fatal = status.problems.find((problem) => problem.startsWith("OPTIONS_INVALID") || problem.startsWith("HOST_UNTESTED"))
  if (fatal) return fatal.split(" Next step: ")[1] ?? "Fix the plugin options, then restart OpenCode."
  if (status.state === "conflict") {
    const source = status.source as Extract<ServerSource, { type: "conflict" }>
    return `Your OpenCode config defines mcp.servers.${SERVER_NAME} as ${source.command}, but this plugin registers the pinned binary. Every tool of that server is denied; remove the entry, then restart OpenCode, or set the plugin's "path" option to the binary you mean.`
  }
  if (status.legacy) {
    return `An older "opencode-browser" MCP server is still configured, and its tools are denied by this plugin. Remove that entry from opencode.json, then restart OpenCode.`
  }
  if (status.state === "host_untested") return `Use OpenCode ${testedText(manifest)}, or set the plugin option "allowUntestedHost": true to run anyway.`
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
    return `Browse lists ${status.unknownCount} tool(s) this plugin does not classify. They follow each agent's own rules. Update ${PLUGIN_NAME} to a release that knows them, or set a rule for one by exact name.`
  }
  if (status.unguardedAgents.length) {
    return `Put the default rules shown by /browse-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Browse tools.`
  }
  const recording = recordingNextStep(status.recording)
  if (recording) return recording
  if (status.updates.available) return `browse ${status.updates.available} is available. Update this plugin to move to it; the pinned binary does not update itself.`
  if (extra.statusProblem) return `\`browse status\` did not answer: ${extra.statusProblem}. Run /browse-doctor.`
  return NOTHING_TO_DO
}

/** The host APIs the live report reads. All are public: `ctx.mcp`, `ctx.agent` and `ctx.tool`. */
export interface ReportContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
}

/** How long after a status change no tools still means "listing". */
const LISTING_MS = 15_000
export interface ListingState {
  readonly changedAt: () => number
}

/**
 * Reads the live facts through public host APIs, plus the engine's cached `browse status --json` and the managed
 * browser's state. Never drives the browser: the report is observational and starts nothing.
 */
export async function readReport(
  manifest: Manifest,
  ctx: ReportContext,
  facts: Omit<ReportFacts, "host" | "level" | "unguardedAgents" | "mode" | "binary" | "managed"> & {
    readonly host: HostCheck
    readonly level: AccessLevel
    readonly mode: "real" | "managed"
    readonly binary: BinaryFacts
    readonly unguardedAgents: readonly string[]
    readonly live: () => Promise<{ status?: BrowseStatus; reason?: string }>
    readonly managed?: () => ManagedStatus | undefined
    readonly listing?: ListingState
  },
) {
  const [servers, tools] = await Promise.all([ctx.mcp.list(), ctx.tool.list()])
  const server = servers.data.find((entry) => entry.name === SERVER_NAME)
  const legacy = servers.data.some((entry) => entry.name === "opencode-browser")
  const { live, listing, managed, ...rest } = facts
  const liveResult = await live()
  const status = liveResult.status
  const scopeSession = rest.scope
  const liveScope = status && scopeSession ? status.sessions.find((entry) => entry.id === scopeSession.session) : undefined
  const settling = listing !== undefined && Date.now() - listing.changedAt() < LISTING_MS
  return buildReport(manifest, {
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
  })
}

