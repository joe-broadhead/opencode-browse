import { Plugin } from "@opencode/plugin"
import { errorText, NAMESPACE_DESCRIPTION, PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { ensureScope, probeVersion, readStatus, resolveBinary, type BinaryInfo, type BrowseStatus, type Probe, type ScopeResult } from "./engine.js"
import { checkHost } from "./host-version.js"
import { isScoped, parseOptions, type Options } from "./options.js"
import { defaultRules, registerDefaultRules, type RuleSet } from "./permissions.js"
import { reasonOf } from "./redact.js"
import { loadSkills, registerSkills } from "./skills.js"
import { buildStatus, readStatus as readStatusModel, registerStatusCommand, registerStatusRpc, type ServerSource, type Status } from "./status.js"
import { registerToolsRpc, METHODS } from "./host/tools-rpc.js"
import { registerDoctorCommand } from "./doctor.js"

/** Internal seam: tests point the plugin at their own skills and a shorter status timeout. */
interface BrowseSeam {
  readonly skillsDir?: string
  readonly statusTimeoutMs?: number
}

/** The environment the entry carries: the session pin when the options set a scope, and nothing else. */
export function serverEnvironment(options: Options): Record<string, string> {
  return options.scope === undefined ? {} : { OPENCODE_BROWSER_SESSION: options.scope.session }
}

const commandText = (command: readonly string[]) => command.join(" ")

/**
 * True when the entry is a `browse` MCP server this plugin can own: a local command ending in `mcp` whose program is
 * a browse binary (the vendor's installer, a global npm package, or the pinned path). Of the user's entry only the
 * type and the command are read, never its environment.
 */
function owned(command: unknown): boolean {
  if (!Array.isArray(command) || command.length < 2) return false
  const parts = command.filter((part): part is string => typeof part === "string")
  if (parts.length !== command.length || parts.at(-1) !== "mcp") return false
  const program = parts.at(-2) ?? ""
  return /(^|[/\\])browse(\.exe)?$/.test(program) || /[/\\]@opencode[/\\]browse[/\\]dist[/\\]cli\.m?js$/.test(program)
}

/**
 * Registers `browse` as a local MCP server with the pinned binary, or adopts the user's own browse entry (the
 * installer's, or a global npm one) by replacing only its command, so the pinned binary is what runs. Everything else
 * the user set — `disabled`, timeouts, other environment keys — is kept. An entry under this name that is not a
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
        : errorText("SERVER_LEGACY", `An older "opencode-browser" MCP entry is still in your config, and this plugin registers "${SERVER_NAME}".`, `Remove the "opencode-browser" entry, then restart OpenCode.`)
      const existing = editor.get(SERVER_NAME)
      if (existing === undefined) {
        if (entry === undefined) return record(undefined)
        editor.set(SERVER_NAME, { type: "local", command: [...entry.command], environment: { ...entry.environment } })
        return record({ type: "plugin", command: commandText(entry.command) }, legacyProblem)
      }
      if (existing.type !== "local") {
        return record({ type: "conflict", command: existing.type, expected: entry === undefined ? "the pinned browse binary" : commandText(entry.command) }, legacyProblem)
      }
      if (!owned(existing.command)) {
        return record({
          type: "conflict",
          command: commandText(existing.command.filter((part): part is string => typeof part === "string")),
          expected: entry === undefined ? "the pinned browse binary" : commandText(entry.command),
        }, legacyProblem)
      }
      if (entry === undefined) {
        return record({ type: "adopted", command: commandText(existing.command.filter((part): part is string => typeof part === "string")) }, legacyProblem)
      }
      // Keep everything else, including a `disabled` the user chose; set only our command and session pin.
      editor.update(SERVER_NAME, (config) => {
        if (config.type !== "local") return
        config.command = [...entry.command]
        const environment = config.environment !== null && typeof config.environment === "object" && !Array.isArray(config.environment) ? config.environment : {}
        config.environment = { ...environment, ...entry.environment }
      })
      record({ type: "adopted", command: commandText(entry.command) }, legacyProblem)
    } catch (error) {
      record(undefined, errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server could not be registered (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
}

/** A small cache so a status read and a doctor run close together do not shell out twice. */
function cachedLive(bin: string | undefined, timeoutMs: number) {
  let value: { at: number; status?: BrowseStatus; reason?: string } | undefined
  return async (force = false) => {
    if (bin === undefined) return { reason: "there is no browse binary to ask" }
    if (!force && value !== undefined && Date.now() - value.at < 3_000) return value
    const next = await readStatus(bin, timeoutMs)
    value = { at: Date.now(), ...next }
    return next
  }
}

export function createBrowsePlugin(seam: BrowseSeam = {}) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      const options = parseOptions(ctx.options)
      const host = checkHost(ctx.app.version, options.allowUntestedHost)
      const { skills, problems: skillProblems } = await loadSkills(seam.skillsDir)
      const problems = new Map<string, string>(skillProblems.map((problem, index) => [`skill:${index}`, problem]))
      const report = (area: string) => (problem: string | undefined) => void (problem ? problems.set(area, problem) : problems.delete(area))

      const rules: RuleSet = { scoped: isScoped(options), readOnly: options.scope?.readOnly === true }

      // The binary: resolved once, synchronously, so the transform can register the server in this same tick.
      let binary: BinaryInfo | undefined
      let binaryProblem: string | undefined
      try {
        binary = resolveBinary({ ...(options.path ? { optionPath: options.path } : {}), verify: options.verifyBinary })
      } catch (error) {
        const code = (error as { code?: string }).code ?? "BINARY_MISSING"
        const message = (error as Error).message.replace(/^[A-Z_]+: /, "").split(" Next step: ")[0] ?? "the browse binary could not be resolved."
        const next = (error as { nextStep?: string }).nextStep ?? "Reinstall the plugin."
        binaryProblem = errorText(code, message, next)
      }

      let source: ServerSource | undefined
      await registerServer(
        ctx.mcp,
        binary === undefined ? undefined : { command: [binary.path, "mcp"], environment: serverEnvironment(options) },
        (next, problem) => {
          source = next
          report("server")(problem)
        },
      )
      // Code Mode's catalog describes the namespace with this text; a conflicting entry keeps its own.
      await ctx.tool.transform((editor) => {
        if (source?.type !== "conflict") editor.namespace({ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION })
      })
      await registerDefaultRules(ctx.agent, defaultRules(rules), rules, report("rules"))

      // The pinned session: created or repaired once at setup when the options ask for one.
      let scopeResult: ScopeResult | undefined
      let scopeProblem: string | undefined
      const applyScope = async (force: boolean): Promise<ScopeResult | undefined> => {
        if (binary === undefined || options.scope === undefined) return undefined
        if (!force && scopeResult !== undefined) return scopeResult
        try {
          scopeResult = await ensureScope(binary.path, options.scope)
          scopeProblem = undefined
          return scopeResult
        } catch (error) {
          const code = (error as { code?: string }).code ?? "SCOPE_UNREACHABLE"
          const message = (error as Error).message.replace(/^[A-Z_]+: /, "").split(" Next step: ")[0] ?? "the pinned session could not be prepared."
          scopeProblem = errorText(code, message, (error as { nextStep?: string }).nextStep ?? "Run /browse-doctor.")
          throw error
        }
      }
      if (binary !== undefined && options.scope !== undefined) await applyScope(false).catch(() => undefined)

      // The version probe is a one-off at setup; status shows its answer.
      let probe: Probe | null = null
      if (binary !== undefined) void probeVersion(binary.path).then((result) => (probe = result))
      const live = cachedLive(binary?.path, seam.statusTimeoutMs ?? 10_000)

      const read = async (): Promise<Status> => {
        if (binary === undefined) {
          return buildStatus({
            host,
            rules,
            binary: { path: null, version: null, source: null, verified: false, tested: false, supported: false },
            ...(binaryProblem ? { binaryProblem } : {}),
            ...(source ? { source } : {}),
            ...(scopeProblem ? { scopeProblem } : {}),
            problems: [...problems.values()],
          })
        }
        return readStatusModel(ctx, {
          host,
          rules,
          binary,
          ...(source ? { source } : {}),
          probe,
          ...(options.scope
            ? { scope: { session: options.scope.session, readOnly: options.scope.readOnly, allowedOrigins: options.scope.allowedOrigins, matches: scopeResult !== undefined } }
            : {}),
          ...(scopeProblem ? { scopeProblem } : {}),
          problems: [...problems.values()],
          live: () => live(),
        })
      }

      await registerSkills(ctx.skill, skills)
      await registerStatusCommand(ctx, read)
      await registerStatusRpc(ctx.rpc, read)
      await registerDoctorCommand(ctx, {
        binary: () => binary,
        live: () => live(true),
        scope: () => options.scope,
        applyScope,
        problems: () => [...problems.values()],
        host,
      })
      const stopTools = await registerToolsRpc(ctx, { methods: METHODS, mcp: { server: SERVER_NAME, managed: () => source?.type !== "conflict" } })
      return async () => {
        await stopTools()
      }
    },
  })
}

export type { Status }
