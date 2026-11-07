// Every fact the plugin keeps about browse's MCP tools: the 18 the server lists at 0.0.14 (9bf2dac), each with its
// MCP annotation, its class for the tools RPC, and the default permission effect.
// The default rules, the tools RPC's table, status's unknown tools, the Jelly declaration and the tests all derive
// from this file, so a tool cannot drift between them. Keep it free of runtime imports: scripts/check-browse-tools.mjs
// and the drift job load it directly.
//
// Effects: the reads and the tab cleanup run; the page action, the session tools, the settings and
// the three tools that act with the user's secrets or widen reach ask; nothing known is off. A tool browse adds later
// matches no exact name, so DEFAULT_UNKNOWN denies it until it is classified here.

/** What a tool's worst case is, for the tools RPC and a Jelly approval. The rules, not the class, decide a call. */
export type ToolClass = "read" | "write" | "export" | "destructive"

/** The host's permission effect. */
export type Effect = "allow" | "ask" | "deny"

export interface ToolSpec {
  readonly name: string
  readonly class: ToolClass
  /** The effect the default rules give it. */
  readonly effect: Effect
  /** MCP's `readOnlyHint`, as the server sends it. */
  readonly readOnly: boolean
  /** MCP's `destructiveHint`. */
  readonly destructive: boolean
  /** MCP's `idempotentHint`. */
  readonly idempotent: boolean
  /** MCP's `openWorldHint`. */
  readonly openWorld: boolean
  /** What the tool does, in one line, for status and the docs. */
  readonly summary: string
}

/**
 * The default for a tool name this table does not classify. The first rule is `browse_*` deny, so a tool browse adds
 * later is off until a release of this plugin classifies it; a user can still allow one by name.
 */
export const DEFAULT_UNKNOWN: Effect = "deny"

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "status",
    class: "read",
    effect: "allow",
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    summary: "relay, extension, browser and session state",
  },
  {
    name: "session_list",
    class: "read",
    effect: "allow",
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    summary: "sessions and each one's read-only flag and allowed origins",
  },
  {
    name: "secrets_list",
    class: "read",
    effect: "allow",
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    summary: "stored site secrets: names, kinds and origins, never values",
  },
  {
    name: "secrets_status",
    class: "read",
    effect: "allow",
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    summary: "a secret profile's references and expiry, never values",
  },
  {
    name: "tabs_cleanup",
    class: "destructive",
    effect: "allow",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
    summary: "closes idle tabs agents opened",
  },
  {
    name: "execute",
    class: "destructive",
    effect: "ask",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
    summary: "runs Playwright code on the session's page: navigate, click, type, read",
  },
  {
    name: "session_new",
    class: "write",
    effect: "ask",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    summary: "creates a session, optionally read-only or limited to origins",
  },
  {
    name: "session_use",
    class: "write",
    effect: "ask",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    summary: "switches this server to another session",
  },
  {
    name: "session_adopt",
    class: "write",
    effect: "ask",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    summary: "takes over a tab the user lent with the toolbar button",
  },
  {
    name: "session_reset",
    class: "destructive",
    effect: "ask",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    summary: "resets a session's page and state",
  },
  {
    name: "session_delete",
    class: "destructive",
    effect: "ask",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
    summary: "deletes a session and its pages",
  },
  {
    name: "settings",
    class: "write",
    effect: "ask",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    summary: "reads or changes the user's browse settings",
  },
  {
    name: "network",
    class: "export",
    effect: "allow",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    summary: "captures the session's HTTP traffic to a redacted HAR",
  },
  {
    name: "recording",
    class: "export",
    effect: "allow",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    summary: "records the session's tab to MP4 or WebM",
  },
  {
    name: "flight_recorder",
    class: "export",
    effect: "allow",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    summary: "keeps a rolling video buffer and saves the last minute",
  },
  {
    name: "secrets_run",
    class: "destructive",
    effect: "ask",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    summary: "runs a local command with stored credentials in its environment",
  },
  {
    name: "secrets_refresh",
    class: "destructive",
    effect: "ask",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
    summary: "reloads the page, re-observes credentials and updates a secret profile",
  },
  {
    name: "session_allowlist",
    class: "destructive",
    effect: "ask",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    summary: "replaces a session's allowed origins",
  },
]

/** The 18 names, in table order. */
export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name)

/** The exact lookup a rule, the RPC and a Jelly entry use. Unknown names get DEFAULT_UNKNOWN. */
export function effectOf(name: string): Effect {
  return TOOLS.find((tool) => tool.name === name)?.effect ?? DEFAULT_UNKNOWN
}

export function classify(name: string): ToolClass | "unknown" {
  return TOOLS.find((tool) => tool.name === name)?.class ?? "unknown"
}

export function specOf(name: string): ToolSpec | undefined {
  return TOOLS.find((tool) => tool.name === name)
}

/**
 * The scoped profile: the session tools that could leave a pinned session or widen its reach
 * are off, and `execute` runs when the pinned session is read-only (input is refused by the relay) and asks otherwise.
 */
export const SCOPED_EFFECTS: Readonly<Record<string, Effect>> = {
  session_new: "deny",
  session_use: "deny",
  session_adopt: "deny",
  session_delete: "deny",
  session_allowlist: "deny",
}

/** The effect of a tool under the scoped profile, or its default. */
export function scopedEffectOf(name: string, readOnly: boolean): Effect {
  const override = SCOPED_EFFECTS[name]
  if (override !== undefined) return override
  if (name === "execute" && readOnly) return "allow"
  return effectOf(name)
}
