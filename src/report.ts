// Browse's diagnostic report: its shape, the one text `/browse-status` prints, and the status dialog's RPC
// definition. This module is inlined into the terminal-UI bundle too, so it imports no contract module: the report is
// built in the server half (report-build.ts) and this half only describes and prints it.
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { SERVER_NAME } from "./constants.js"
import type { ManagedStatus } from "./provider/managed.js"
import { formatRecording, type RecordingReadiness } from "./provider/recording.js"
import { shortReason } from "./redact.js"

export { shortReason }

const strings = { type: "array", items: { type: "string" } }
const count = { type: "integer", minimum: 0 }
const nullableString = { type: ["string", "null"] }
const nullableBoolean = { type: ["boolean", "null"] }

/** OpenCode's version as this plugin reports it: the `host` fields every plugin of this family shares. */
export interface HostCheck {
  /** OpenCode's version, or null when it reports none. */
  readonly version: string | null
  /** The supported range, `capabilities.plugin.host.opencode`. */
  readonly range: string
  /** True only for a release every check runs on. */
  readonly tested: boolean
}

/** The host fields from the manifest and the version the host reports. */
export function hostOf(manifest: Manifest, version: string): HostCheck {
  return { version: version === "" ? null : version, range: manifest.plugin.host.opencode, tested: manifest.plugin.host.tested.includes(version) }
}

export type State = "connected" | "connecting" | "failed" | "disabled" | "not_configured" | "conflict" | "host_untested"

export type { ServerSource } from "./provider/server.js"

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

/** What the report is built from. The TUI fills what it can see; fields it cannot see stay undefined. */
export interface ReportFacts {
  readonly server?: { readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; readonly error?: string }
  readonly source?: import("./provider/server.js").ServerSource
  readonly host: HostCheck
  readonly level: AccessLevel
  readonly binary: BinaryFacts
  readonly binaryProblem?: string
  /** Option or host validation failed, or the plugin could not start: the model is report-only. */
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
  readonly unguardedAgents: readonly string[]
  readonly problems?: readonly string[]
  readonly updates?: { readonly autoUpdate: string | null; readonly available: string | null }
}

export interface Report {
  readonly version: string
  readonly state: State
  readonly error?: string
  readonly source?: import("./provider/server.js").ServerSource
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
  readonly accessMode: AccessLevel
  readonly problems: readonly string[]
  readonly updates: { readonly autoUpdate: string | null; readonly available: string | null }
  readonly nextStep: string
}


/** The three access levels (contract §6), as the report names them. */
export type AccessLevel = "all" | "ask-changes" | "read-only"
const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
  host_untested: "host untested",
}

function sourceText(source: import("./provider/server.js").ServerSource) {
  if (source.type === "plugin") return `${source.command}, registered by this plugin`
  if (source.type === "adopted") return `${source.command}, your own mcp.servers.${SERVER_NAME}, used with the pinned binary`
  return `your mcp.servers.${SERVER_NAME} points at ${source.command}`
}

function binaryText({ binary }: Report) {
  const { path, version, source, verified, tested } = binary
  if (path === null) return "none"
  const flags = [verified ? "verified at startup" : "unverified", tested ? "pinned" : "untested"].join(", ")
  const origin = source === "option" ? "your path option" : source === "environment" ? "the test seam" : "the release"
  return `browse ${version ?? "unknown version"} (${flags}; ${origin}) · ${path}`
}

function extensionText({ extension }: Report) {
  if (extension.connected) return `paired and connected${extension.version ? ` · ${extension.version}` : ""}${extension.compatible === false ? " · protocol incompatible" : ""}`
  if (extension.pairingState === "unpaired") return "not paired"
  if (extension.pairingState) return `not connected (${extension.pairingState})`
  return "not connected"
}

function relayText({ relay }: Report) {
  if (!relay.running) return "stopped"
  return `running${relay.version ? ` · ${relay.version}` : ""}${relay.stale ? " · stale build" : ""} · auto-update off`
}

function managedText({ managed }: Report) {
  if (managed === undefined) return undefined
  const chromium = managed.chromium.path === null
    ? `none${managed.chromiumPin ? ` (pinned Chrome for Testing ${managed.chromiumPin.version}${managed.chromiumPin.supported ? "" : ", no build for this platform"})` : ""}`
    : `Chrome for Testing ${managed.chromium.version} (${managed.chromium.verified ? "verified" : "unverified, your own"}; ${managed.chromium.source}) · ${managed.chromium.path}`
  const running = managed.state === "running" && managed.pid !== null ? ` · pid ${managed.pid}${managed.headless ? " · headless" : " · headed"}` : ""
  return `${managed.state}${running} · extension ${managed.extension.version ?? "unknown"} · ${chromium}`
}

const ACCESS_TEXT = (status: Report) => `${status.access.run} run · ${status.access.ask} ask · ${status.access.off} off; option access is "${status.accessMode}"`

function toolsText({ tools, unknownCount, unknownTools }: Report) {
  if (unknownCount === 0) return `${tools} available, 0 unknown`
  const more = unknownCount - unknownTools.length
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  return `${tools} available, ${unknownCount} unknown${names} (an unknown tool runs on the agent's own rules)`
}

export function formatReport(status: Report) {
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
    `- Agents without default rules: ${status.unguardedAgents.length ? status.unguardedAgents.join(", ") : "none"}`,
    `- OpenCode: ${status.host.version ?? "unknown version"} (${status.host.tested ? "tested" : "untested"}; supported range ${status.host.range})${status.problems.length ? `. ${status.problems.join(" ")}` : ""}`,
    `- Next step: ${status.nextStep}`,
  ].join("\n")
}

/** The report's shape, reused by the handler's output and the status dialog's RPC call. */
export const REPORT_SCHEMA: Record<string, unknown> = {
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
}

/** The status dialog's RPC definition: the contract's one RPC id, and the `report` method the dialog reads. */
export const ReportRpc = {
  id: "browse",
  methods: {
    report: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: REPORT_SCHEMA,
    },
  },
  events: {},
} as const
