// The `browse` MCP server: the one local server this plugin owns, whose command is the verifying wrapper around the
// pinned binary. The vendor's server owns its 18 tools; this module registers it with OpenCode and adopts the entry a
// person already has, so one `browse` server is configured and the pinned binary is what runs.
import type { Plugin } from "@opencode/plugin"
import { join } from "node:path"
import { errorText, SERVER_NAME } from "../constants.js"
import { packageRoot } from "../package.js"
import { reasonOf } from "../redact.js"
import type { BinaryInfo } from "./binary.js"
import type { Options } from "../options.js"

/** The MCP entry: a wrapper that re-verifies the pinned binary at every spawn. */
export const wrapperPath = () => join(packageRoot, "bin", "mcp.mjs")

/** The MCP command for a resolved binary: the wrapper, the pin it must match, the binary and `mcp`. */
export const serverCommand = (info: BinaryInfo): string[] => [wrapperPath(), ...(info.pinnedSha256 === undefined ? [] : ["--pinned", info.pinnedSha256]), info.path, "mcp"]

/**
 * The entry's environment. browse's own two switches are always set: `MCP_DIRECT=1` makes the binary serve instead of
 * supervising, so it can never hand off to another `browse` on this machine, and `AUTO_UPDATE=off` stops the relay from
 * replacing the pinned file. The session pin is set only by a scope, and removed when the scope is removed.
 */
export function serverEnvironment(options: Options): Record<string, string> {
  return {
    OPENCODE_BROWSER_MCP_DIRECT: "1",
    OPENCODE_BROWSER_AUTO_UPDATE: "off",
    ...(options.scope === undefined ? {} : { OPENCODE_BROWSER_SESSION: options.scope.session }),
  }
}

const commandText = (command: readonly string[]) => command.join(" ")

/** Where a `browse` server entry stands: registered by this plugin, adopted from the person's config, or a conflict. */
export type ServerSource =
  | { readonly type: "plugin"; readonly command: string }
  | { readonly type: "adopted"; readonly command: string }
  | { readonly type: "conflict"; readonly command: string; readonly expected: string }

/**
 * True when the entry is a browse MCP server this plugin can own: our wrapper, a browse binary, or the vendor's
 * unpacked/global npm entry. Of the person's entry only the type and the command are read, never its environment.
 */
export function owned(command: unknown): boolean {
  if (!Array.isArray(command) || command.length < 2) return false
  const parts = command.filter((part): part is string => typeof part === "string")
  if (parts.length !== command.length || parts.at(-1) !== "mcp") return false
  // Our wrapper: [wrapperPath, ("--pinned", sha256)?, binary, "mcp"]; the program is the entry before "mcp".
  const program = parts.at(-2) ?? ""
  if (parts.some((part) => /[/\\]browse-plugin[/\\]bin[/\\]mcp\.mjs$/.test(part))) return true
  return /(^|[/\\])browse(\.exe)?$/.test(program) || /[/\\]@opencode[/\\]browse[/\\]dist[/\\]cli\.m?js$/.test(program)
}

/**
 * Registers `browse` as a local MCP server running our verifying wrapper, or adopts the person's own browse entry by
 * replacing only its command and the two switches plus the session pin, so the pinned binary is what runs. Everything
 * else the person set — `disabled`, timeouts, other environment keys — is kept. An entry under this name that is not a
 * browse command is a conflict, and nothing is registered. Synchronous and never throws.
 */
export function registerServer(
  mcp: Pick<Plugin.Context["mcp"], "transform">,
  entry: { readonly command: readonly string[]; readonly environment: Record<string, string> } | undefined,
  record: (source: ServerSource | undefined, problem?: string) => void,
) {
  return mcp.transform((editor) => {
    try {
      const legacy = editor.get("opencode-browser")
      const legacyProblem = legacy === undefined
        ? undefined
        : errorText("SERVER_LEGACY", `An older "opencode-browser" MCP server is still in your config, alongside this plugin.`, `Remove the "opencode-browser" entry, then restart OpenCode.`)
      const existing = editor.get(SERVER_NAME)
      if (existing === undefined) {
        if (entry === undefined) return record(undefined, legacyProblem)
        editor.set(SERVER_NAME, { type: "local", command: [...entry.command], environment: { ...entry.environment } })
        return record({ type: "plugin", command: commandText(entry.command) }, legacyProblem)
      }
      if (existing.type !== "local") {
        return record({ type: "conflict", command: existing.type, expected: entry === undefined ? "the pinned browse binary" : commandText(entry.command) }, legacyProblem)
      }
      if (!owned(existing.command)) {
        return record(
          {
            type: "conflict",
            command: commandText(existing.command.filter((part): part is string => typeof part === "string")),
            expected: entry === undefined ? "the pinned browse binary" : commandText(entry.command),
          },
          legacyProblem,
        )
      }
      if (entry === undefined) {
        return record({ type: "adopted", command: commandText(existing.command.filter((part): part is string => typeof part === "string")) }, legacyProblem)
      }
      editor.update(SERVER_NAME, (config) => {
        if (config.type !== "local") return
        config.command = [...entry.command]
        const environment = config.environment !== null && typeof config.environment === "object" && !Array.isArray(config.environment) ? config.environment : {}
        const next = { ...environment, ...entry.environment }
        // Removing `scope` unpins the session: the old pin must not survive in the entry.
        if (!("OPENCODE_BROWSER_SESSION" in entry.environment)) delete next.OPENCODE_BROWSER_SESSION
        config.environment = next
      })
      record({ type: "adopted", command: commandText(entry.command) }, legacyProblem)
    } catch (error) {
      record(undefined, errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server could not be registered (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
}
