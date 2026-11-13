import { ACCESS_VALUES, type Access } from "./browse-tools.js"
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
  /** `real` (the user's browser, with the Web Store extension) or `managed` (a separate Chromium and profile). */
  readonly browser: "real" | "managed"
  /** A Chromium or Chrome for Testing binary for managed mode, instead of the pinned download. */
  readonly chromiumPath?: string
  /** Run the managed browser headless. Headed by default, so the user can watch. */
  readonly headless: boolean
  /** Pin the server to a browse session with this scope. */
  readonly scope?: ScopeOptions
  /** Check the pinned binary's SHA-256 before running it (the default). */
  readonly verifyBinary: boolean
  /** Run on an OpenCode version outside the supported range, with a warning in status. */
  readonly allowUntestedHost: boolean
  /** What the plugin's own tools may do without asking: everything, ask for changes, or reads only. */
  readonly access: Access
}

const EXAMPLE = `"plugins": [{ "package": "github:joe-broadhead/opencode-browse#v0.0.1", "options": { "scope": { "allowedOrigins": ["github.com"] } } }]`
const ACCEPTED = ["path", "browser", "chromiumPath", "headless", "scope", "verifyBinary", "allowUntestedHost", "access"] as const

const invalid = (problem: string) =>
  browseError("OPTIONS_INVALID", `${problem}.`, `Fix the plugin options in opencode.json, for example ${EXAMPLE}.`)

const describe = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" ? "an object" : String(value)

const SESSION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ORIGIN = /^(?:https?:\/\/)?(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/

/** Validates the plugin options from opencode.json. Every option is optional. */
export function parseOptions(raw: unknown): Options {
  const defaults: Options = { browser: "real", headless: false, verifyBinary: true, allowUntestedHost: false, access: "all" }
  if (raw === undefined || raw === null) return defaults
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(`The plugin options must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!(ACCEPTED as readonly string[]).includes(key)) {
      throw invalid(`Unknown option "${key}". Accepted options: ${ACCEPTED.map((name) => `"${name}"`).join(", ")}`)
    }
  }
  const { path, browser = "real", chromiumPath, headless = false, scope, verifyBinary = true, allowUntestedHost = false, access = "all" } = input
  if (path !== undefined && (typeof path !== "string" || path.trim() === "")) {
    throw invalid(`The option "path" must be a file path, found ${describe(path)}`)
  }
  if (browser !== "real" && browser !== "managed") throw invalid(`The option "browser" must be "real" or "managed", found ${describe(browser)}`)
  if (chromiumPath !== undefined && (typeof chromiumPath !== "string" || chromiumPath.trim() === "")) throw invalid(`The option "chromiumPath" must be a file path, found ${describe(chromiumPath)}`)
  if (typeof headless !== "boolean") throw invalid(`The option "headless" must be true or false, found ${describe(headless)}`)
  if (typeof verifyBinary !== "boolean") throw invalid(`The option "verifyBinary" must be true or false, found ${describe(verifyBinary)}`)
  if (typeof allowUntestedHost !== "boolean") throw invalid(`The option "allowUntestedHost" must be true or false, found ${describe(allowUntestedHost)}`)
  if (typeof access !== "string" || !(ACCESS_VALUES as readonly string[]).includes(access)) throw invalid(`The option "access" must be ${ACCESS_VALUES.map((value) => `"${value}"`).join(", ")}, found ${describe(access)}`)
  return {
    ...(typeof path === "string" ? { path: path.trim() } : {}),
    browser,
    ...(typeof chromiumPath === "string" ? { chromiumPath: chromiumPath.trim() } : {}),
    headless,
    ...(scope === undefined ? {} : { scope: parseScope(scope) }),
    verifyBinary,
    allowUntestedHost,
    access: access as Access,
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
