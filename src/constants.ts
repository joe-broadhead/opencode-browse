/** The plugin id, tool namespace and RPC id (contract §3). */
export const PLUGIN_ID = "browse"
/** The MCP server name. Permission actions are `<server>_<tool>`, so this is also the rules' prefix. */
export const SERVER_NAME = "browse"
/** The browse release this plugin pins and ships. A person's own binary is reported untested. */
export const PINNED_VERSION = "0.0.15"
/** The default session name a scoped install pins the server to. */
export const DEFAULT_SCOPE_SESSION = "opencode"

/**
 * Every code this plugin's own code raises or prints. The contract's own codes (`HOST_UNTESTED`, `OPTIONS_INVALID`,
 * `INPUT_INVALID`, `PERMISSION_DENIED`, `UNAVAILABLE`) come from the contract; the codes here are browse's additions,
 * and the README's table names each one.
 */
export type PluginCode =
  | "SERVER_NOT_REGISTERED"
  | "SERVER_LEGACY"
  | "BINARY_MISSING"
  | "BINARY_UNVERIFIED"
  | "UNSUPPORTED_PLATFORM"
  | "SCOPE_LOST"
  | "SCOPE_UNREACHABLE"
  | "RELAY_FAILED"
  | "RELAY_NOT_OURS"
  | "RELAY_STOP_FAILED"
  | "STATUS_UNAVAILABLE"
  | "DOCTOR_FAILED"
  | "NOT_INSTALLED"
  | "CHROMIUM_MISSING"
  | "CHROMIUM_INVALID"
  | "CHROMIUM_BRANDED"
  | "CHROMIUM_UNSUPPORTED"
  | "CHROMIUM_DOWNLOAD_FAILED"
  | "CHROMIUM_EXTRACT_FAILED"
  | "CHROMIUM_UNVERIFIED"
  | "CHROMIUM_INSTALL_FAILED"
  | "EXTENSION_UNVERIFIED"

export const PLUGIN_CODES: readonly PluginCode[] = [
  "SERVER_NOT_REGISTERED",
  "SERVER_LEGACY",
  "BINARY_MISSING",
  "BINARY_UNVERIFIED",
  "UNSUPPORTED_PLATFORM",
  "SCOPE_LOST",
  "SCOPE_UNREACHABLE",
  "RELAY_FAILED",
  "RELAY_NOT_OURS",
  "RELAY_STOP_FAILED",
  "STATUS_UNAVAILABLE",
  "DOCTOR_FAILED",
  "NOT_INSTALLED",
  "CHROMIUM_MISSING",
  "CHROMIUM_INVALID",
  "CHROMIUM_BRANDED",
  "CHROMIUM_UNSUPPORTED",
  "CHROMIUM_DOWNLOAD_FAILED",
  "CHROMIUM_EXTRACT_FAILED",
  "CHROMIUM_UNVERIFIED",
  "CHROMIUM_INSTALL_FAILED",
  "EXTENSION_UNVERIFIED",
]

export const isPluginCode = (value: unknown): value is PluginCode => typeof value === "string" && (PLUGIN_CODES as readonly string[]).includes(value)

/** The one error shape: `CODE: What happened. Next step: What to do.` Both parts are sentences. */
export const errorText = (code: PluginCode, message: string, nextStep: string) => `${code}: ${message} Next step: ${nextStep}`

export function browseError(code: PluginCode, message: string, nextStep: string) {
  return Object.assign(new Error(errorText(code, message, nextStep)), { code, nextStep })
}
