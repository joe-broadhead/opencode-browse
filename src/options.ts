import { browseError, DEFAULT_SCOPE_SESSION } from "./constants.js"

export interface ScopeOptions {
  /** The browse session the server is pinned to. */
  readonly session: string
  /** Hosts or origins the session's tabs may load; empty means no allowlist (browse's own default). */
  readonly allowedOrigins: readonly string[]
  /** Pin a read-only session, whose input the relay refuses. */
  readonly readOnly: boolean
}

export interface Options {
  /** A browse binary to use instead of the pinned one. Reported unverified and untested. */
  readonly path?: string
  /** Pin the server to a browse session with this scope. */
  readonly scope?: ScopeOptions
  /** Check the pinned binary's SHA-256 before running it (the default). */
  readonly verifyBinary: boolean
  /** Run on an OpenCode version outside the supported range, with a warning in status. */
  readonly allowUntestedHost: boolean
}

const EXAMPLE = `"plugins": [{ "package": "@joe-broadhead/opencode-browse", "options": { "scope": { "allowedOrigins": ["github.com"] } } }]`
const ACCEPTED = ["path", "scope", "verifyBinary", "allowUntestedHost"] as const

const invalid = (problem: string) =>
  browseError("OPTIONS_INVALID", `${problem}.`, `Fix the plugin options in opencode.json, for example ${EXAMPLE}.`)

const describe = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" ? "an object" : String(value)

const SESSION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ORIGIN = /^(?:https?:\/\/)?(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/

/** Validates the plugin options from opencode.json. Every option is optional. */
export function parseOptions(raw: unknown): Options {
  const defaults: Options = { verifyBinary: true, allowUntestedHost: false }
  if (raw === undefined || raw === null) return defaults
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(`The plugin options must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!(ACCEPTED as readonly string[]).includes(key)) {
      throw invalid(`Unknown option "${key}". Accepted options: ${ACCEPTED.map((name) => `"${name}"`).join(", ")}`)
    }
  }
  const { path, scope, verifyBinary = true, allowUntestedHost = false } = input
  if (path !== undefined && (typeof path !== "string" || path.trim() === "")) {
    throw invalid(`The option "path" must be a file path, found ${describe(path)}`)
  }
  if (typeof verifyBinary !== "boolean") throw invalid(`The option "verifyBinary" must be true or false, found ${describe(verifyBinary)}`)
  if (typeof allowUntestedHost !== "boolean") throw invalid(`The option "allowUntestedHost" must be true or false, found ${describe(allowUntestedHost)}`)
  return {
    ...(typeof path === "string" ? { path: path.trim() } : {}),
    ...(scope === undefined ? {} : { scope: parseScope(scope) }),
    verifyBinary,
    allowUntestedHost,
  }
}

function parseScope(raw: unknown): ScopeOptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid(`The option "scope" must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!["session", "allowedOrigins", "readOnly"].includes(key)) throw invalid(`Unknown option "scope.${key}"`)
  }
  const session = input.session ?? DEFAULT_SCOPE_SESSION
  if (typeof session !== "string" || !SESSION_NAME.test(session)) {
    throw invalid(`The option "scope.session" must be a session name of lowercase letters, digits, ".", "_" or "-", found ${describe(input.session)}`)
  }
  const allowedOrigins = input.allowedOrigins ?? []
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.every((entry) => typeof entry === "string" && entry.trim() !== "")) {
    throw invalid(`The option "scope.allowedOrigins" must be an array of hosts or origins, found ${describe(input.allowedOrigins)}`)
  }
  const origins = allowedOrigins.map((entry) => (entry as string).trim().toLowerCase())
  if (origins.length > 100) throw invalid(`The option "scope.allowedOrigins" takes at most 100 entries, found ${origins.length}`)
  for (const origin of origins) {
    if (!ORIGIN.test(origin)) throw invalid(`"${origin}" in "scope.allowedOrigins" is not a host or origin, such as example.com or https://app.example.com`)
  }
  const readOnly = input.readOnly ?? false
  if (typeof readOnly !== "boolean") throw invalid(`The option "scope.readOnly" must be true or false, found ${describe(readOnly)}`)
  return { session, allowedOrigins: origins, readOnly }
}

/** True when the options pin a session; the server entry then carries OPENCODE_BROWSER_SESSION. */
export const isScoped = (options: Options) => options.scope !== undefined
