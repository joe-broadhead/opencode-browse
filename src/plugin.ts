import { Plugin } from "@opencode/plugin"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { browseError, errorText, isPluginCode, NAMESPACE_DESCRIPTION, PINNED_VERSION, PLUGIN_ID, SERVER_NAME, SUPPORTED_HOST } from "./constants.js"
import { ensureScope, INSTALL_COMMAND, probeVersion, readStatus, resolveBinary, runBinary, type BinaryInfo, type BrowseStatus, type Probe, type ScopeResult, verifyBinaryNow } from "./engine.js"
import { checkHost, isTestedHost, type HostCheck } from "./host-version.js"
import { isScoped, parseOptions, type Options } from "./options.js"
import { conflictRules, defaultRules, registerDefaultRules, type RuleSet } from "./permissions.js"
import { reasonOf, shortReason } from "./redact.js"
import { loadSkills, registerSkills } from "./skills.js"
import { buildStatus, readStatus as readStatusModel, registerStatusCommand, registerStatusRpc, type ServerSource, type Status } from "./status.js"
import { registerToolsRpc, METHODS } from "./host/tools-rpc.js"
import { registerDoctorCommand } from "./doctor.js"
import { ManagedBrowser } from "./managed/browser.js"
import { formatRelayStop, stopRelaySafely } from "./managed/relay.js"
import { detectRecording, type RecordingReadiness } from "./recording.js"
import { ChromeGate } from "./jelly/chrome-gate.js"
import { registerGate, registerNativeRpc, underJelly, watchSessions } from "./jelly/native.js"
import type { ActionPublicKey } from "./jelly/action-grant.js"

/** Internal seam: tests point the plugin at their own skills and a shorter status timeout. */
export interface BrowseSeam {
  readonly skillsDir?: string
  readonly statusTimeoutMs?: number
  /** Whether this engine is jelly's; by default, whether jelly's engine hand-off is present. */
  readonly jelly?: boolean
  /** jelly's action key, instead of the one jelly publishes in the engine. */
  readonly actionKey?: () => ActionPublicKey | undefined
  /** The per-task ask's time limit. */
  readonly askTimeoutMs?: number
}

/** The package root: `dist/`'s parent when built, the repository when loaded from `src/`. */
const packageRoot = fileURLToPath(new URL("..", import.meta.url))
/** The MCP entry: a wrapper that re-verifies the pinned binary at every spawn. */
export const wrapperPath = () => join(packageRoot, "bin", "mcp.mjs")
/** The MCP command for a resolved binary: the wrapper, the pin it must match, the binary and `mcp`. */
export const serverCommand = (info: BinaryInfo): string[] => [wrapperPath(), ...info.pinnedSha256 === undefined ? [] : ["--pinned", info.pinnedSha256], info.path, "mcp"]

/**
 * The entry's environment. browse's own two switches are always set: `MCP_DIRECT=1` makes the binary serve instead
 * of supervising, so it can never hand off to another `browse` on this machine, and `AUTO_UPDATE=off` stops the relay
 * from replacing the pinned file. The session pin is set only by a scope, and removed when the scope is removed.
 */
export function serverEnvironment(options: Options): Record<string, string> {
  return {
    OPENCODE_BROWSER_MCP_DIRECT: "1",
    OPENCODE_BROWSER_AUTO_UPDATE: "off",
    ...(options.scope === undefined ? {} : { OPENCODE_BROWSER_SESSION: options.scope.session }),
  }
}

const commandText = (command: readonly string[]) => command.join(" ")

/**
 * True when the entry is a browse MCP server this plugin can own: our wrapper, a browse binary, or the vendor's
 * unpacked/global npm entry. Of the user's entry only the type and the command are read, never its environment.
 */
export function owned(command: unknown): boolean {
  if (!Array.isArray(command) || command.length < 2) return false
  const parts = command.filter((part): part is string => typeof part === "string")
  if (parts.length !== command.length || parts.at(-1) !== "mcp") return false
  // Our wrapper: [wrapperPath, ("--pinned", sha256)?, binary, "mcp"]; the program is the entry before "mcp".
  const program = parts.at(-2) ?? ""
  if (parts.some((part) => /[/\\]opencode-browse[/\\]bin[/\\]mcp\.mjs$/.test(part))) return true
  return /(^|[/\\])browse(\.exe)?$/.test(program) || /[/\\]@opencode[/\\]browse[/\\]dist[/\\]cli\.m?js$/.test(program)
}

/**
 * Registers `browse` as a local MCP server running our verifying wrapper, or adopts the user's own browse entry by
 * replacing only its command and the two switches plus the session pin, so the pinned binary is what runs. Everything
 * else the user set — `disabled`, timeouts, other environment keys — is kept. An entry under this name that is not a
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

/** A host check that never throws: the version the host reports and whether it is in range. */
function safeHost(version: string, allowed: boolean): { host: HostCheck; problem?: string } {
  try {
    return { host: checkHost(version, allowed) }
  } catch (error) {
    return {
      host: { version: version === "" ? null : version, range: SUPPORTED_HOST, tested: isTestedHost(version) },
      problem: (error as Error).message,
    }
  }
}

export function createBrowsePlugin(seam: BrowseSeam = {}) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      // Options and the host never throw the plugin away: a bad one becomes a status problem (DR-4).
      let options: Options | undefined
      let optionsProblem: string | undefined
      try {
        options = parseOptions(ctx.options)
      } catch (error) {
        optionsProblem = (error as Error).message
      }
      const hostResult = safeHost(ctx.app.version, options?.allowUntestedHost === true)
      const host = hostResult.host
      const hostProblem = options === undefined ? undefined : hostResult.problem
      const fatal = optionsProblem ?? hostProblem
      const rules: RuleSet = { access: options?.access ?? "all", scoped: options !== undefined && isScoped(options), readOnly: options?.scope?.readOnly === true }

      const { skills, problems: skillProblems } = await loadSkills(seam.skillsDir)
      const problems = new Map<string, string>(skillProblems.map((problem, index) => [`skill:${index}`, problem]))
      const report = (area: string) => (problem: string | undefined) => void (problem ? problems.set(area, problem) : problems.delete(area))

      // With no usable options nothing else is set up, but the deny nets still go in, so a legacy server or a
      // conflicting `browse` server can never run a browser tool unguarded.
      if (fatal !== undefined || options === undefined) {
        const block = conflictRules()
        await registerDefaultRules(ctx.agent, block, report("rules"))
        const read = async (): Promise<Status> =>
          buildStatus({
            host,
            rules,
            mode: "real",
            fatal: fatal ?? errorText("OPTIONS_INVALID", "The plugin options could not be read.", "Fix the plugin options in opencode.json, then restart OpenCode."),
            binary: { path: null, version: null, source: null, verified: false, tested: false, supported: false },
            problems: [...problems.values()],
          })
        await registerSkills(ctx.skill, skills)
        await registerStatusCommand(ctx, read)
        await registerStatusRpc(ctx.rpc, read)
        await registerDoctorCommand(ctx, {
          binary: () => undefined,
          live: async () => ({ reason: "the plugin is not set up" }),
          scope: () => undefined,
          applyScope: async () => undefined,
          problems: () => [...problems.values()],
          host,
          managed: () => undefined,
          recording: () => undefined,
          installBrowser: async () => ({ message: "Managed mode is not set up: fix the plugin options first." }),
        })
        return async () => undefined
      }

      // The binary: the pinned release, downloaded on first use, or the path the person set. Resolved before the server
      // is registered. A first-use download runs only at access "all"; the other values refuse it and name
      // /browse-install, which downloads at any access value (NATIVE-DESIGN.md section 3).
      let binary: BinaryInfo | undefined
      let binaryProblem: string | undefined
      const firstUse = (): void => {
        if (options.access !== "all") {
          throw browseError("BINARY_MISSING", "The browse binary is not installed, and access does not allow a first-use download.", `Run ${INSTALL_COMMAND}, then restart OpenCode.`)
        }
      }
      // Re-checks the resolved binary at each use: a released binary must still hash to its pin.
      const verifyBinary = (): BinaryInfo => {
        if (binary === undefined) throw browseError("BINARY_MISSING", "The browse binary is not resolved.", `Run ${INSTALL_COMMAND}, then restart OpenCode.`)
        binary = verifyBinaryNow(binary, options.verifyBinary)
        return binary
      }
      try {
        binary = await resolveBinary({ ...(options.path ? { optionPath: options.path } : {}), verify: options.verifyBinary, mayDownload: firstUse })
      } catch (error) {
        const caught = (error as { code?: unknown }).code
        const code = isPluginCode(caught) ? caught : "BINARY_MISSING"
        const message = (error as Error).message.replace(/^[A-Z_]+: /, "").split(" Next step: ")[0] ?? "the browse binary could not be resolved."
        const next = (error as { nextStep?: string }).nextStep ?? "Reinstall the plugin."
        binaryProblem = errorText(code, message, next)
      }

      let source: ServerSource | undefined
      await registerServer(
        ctx.mcp,
        binary === undefined ? undefined : { command: serverCommand(binary), environment: serverEnvironment(options) },
        (next, problem) => {
          source = next
          report("server")(problem)
        },
      )
      await ctx.tool.transform((editor) => {
        if (source?.type !== "conflict") editor.namespace({ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION })
      })
      await registerDefaultRules(ctx.agent, source?.type === "conflict" ? conflictRules() : defaultRules(rules), report("rules"))

      // The pinned session: created or repaired once at setup when the options ask for one.
      let scopeResult: ScopeResult | undefined
      let scopeProblem: string | undefined
      const applyScope = async (force: boolean): Promise<ScopeResult | undefined> => {
        if (binary === undefined || options.scope === undefined) return undefined
        if (!force && scopeResult !== undefined) return scopeResult
        try {
          verifyBinary()
          scopeResult = await ensureScope(binary!.path, options.scope)
          scopeProblem = undefined
          return scopeResult
        } catch (error) {
          const caught = (error as { code?: unknown }).code
          const code = isPluginCode(caught) ? caught : "SCOPE_UNREACHABLE"
          const reason = shortReason((error as Error).message.replace(/^[A-Z_]+: /, "").split(" Next step: ")[0] ?? "") ?? "the pinned session could not be prepared"
          scopeProblem = errorText(code, reason, (error as { nextStep?: string }).nextStep ?? "Run /browse-doctor.")
          throw error
        }
      }
      if (binary !== undefined && options.scope !== undefined) await applyScope(false).catch(() => undefined)

      // Managed mode: a separate Chromium and profile, started in the background and stopped on dispose.
      let managed: ManagedBrowser | undefined
      if (binary !== undefined && options.browser === "managed") {
        managed = new ManagedBrowser({
          packageRoot,
          binary: binary.path,
          headless: options.headless,
          ...(options.chromiumPath ? { chromiumPath: options.chromiumPath } : {}),
          verify: () => verifyBinary(),
        })
        void managed.start()
      }

      let probe: Probe | null = null
      if (binary !== undefined) void probeVersion(binary.path).then((result) => (probe = result))
      // Recording readiness: ffmpeg for agent-opened tabs, and the toolbar-click backend that needs nothing.
      let recording: RecordingReadiness | undefined
      void detectRecording().then((result) => (recording = result))
      const live = cachedLive(binary?.path, seam.statusTimeoutMs ?? 10_000)

      const read = async (): Promise<Status> => {
        if (binary === undefined) {
          return buildStatus({
            host,
            rules,
            mode: options.browser,
            ...(binaryProblem ? { binaryProblem } : {}),
            ...(source ? { source } : {}),
            ...(scopeProblem ? { scopeProblem } : {}),
            problems: [...problems.values()],
            ...(recording ? { recording } : {}),
            binary: { path: null, version: null, source: null, verified: false, tested: false, supported: false },
          })
        }
        return readStatusModel(ctx, {
          host,
          rules,
          mode: options.browser,
          binary,
          ...(source ? { source } : {}),
          probe,
          ...(options.scope
            ? { scope: { session: options.scope.session, readOnly: options.scope.readOnly, allowedOrigins: options.scope.allowedOrigins, matches: false } }
            : {}),
          ...(scopeProblem ? { scopeProblem } : {}),
          problems: [...problems.values()],
          ...(recording ? { recording } : {}),
          live: () => live(),
          managed: () => managed?.status(),
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
        managed: () => managed?.status(),
        recording: () => recording,
        installBrowser: async () => {
          if (managed === undefined) return { message: "Set \"browser\": \"managed\" in this plugin's options first." }
          await managed.installAndStart()
          return { message: `Chrome for Testing is installed; the managed browser is ${managed.status().state}.` }
        },
      })
      await registerStopRelayCommand(ctx, { binary: () => binary })
      await ctx.command.transform((editor) =>
        editor.add({
          name: "browse-install",
          description: "Download and verify the pinned browse binary (about 115-135 MB), then restart OpenCode",
          execute: async ({ sessionID }) => {
            let text: string
            if (options.path) {
              text = "This plugin uses the browse binary named by the path option, so there is nothing to download. Remove the path option to use the pinned release."
            } else {
              try {
                const info = await resolveBinary({ verify: options.verifyBinary, mayDownload: () => undefined })
                text = `browse ${info.version ?? PINNED_VERSION} is installed and verified. Restart OpenCode, or run opencode reload, so the browse tools register.`
              } catch (error) {
                const code = (error as { code?: string }).code ?? "BINARY_MISSING"
                const next = (error as { nextStep?: string }).nextStep ?? "Run /browse-doctor."
                text = `${code}: ${shortReason((error as Error).message.replace(/^[A-Z_]+: /, "").split(" Next step: ")[0] ?? "") ?? "the binary could not be installed"}. Next step: ${next}`
              }
            }
            await ctx.session.synthetic({ sessionID, text, description: "Browse install", resume: false })
          },
        }),
      )
      await ctx.command.transform((editor) =>
        editor.add({
          name: "browse-install-browser",
          description: "Download and verify Chrome for Testing for managed mode (about 150-210 MB), then start it",
          execute: async ({ sessionID }) => {
            let text: string
            if (managed === undefined) {
              text = "Managed mode is off. Set \"browser\": \"managed\" in this plugin's options, restart OpenCode, then run /browse-install-browser."
            } else {
              const before = managed.status()
              if (before.state === "running") {
                text = "The managed browser is already running."
              } else {
                try {
                  await managed.installAndStart()
                  const after = managed.status()
                  text = `Chrome for Testing ${after.chromium.version ?? after.chromiumPin?.version ?? ""} is ${after.chromium.verified ? "verified and installed" : "in use"}; the managed browser is ${after.state}. ${after.state === "running" ? "Its profile is separate from your own browser: it starts signed out of every site." : "Run /browse-doctor for the next step."}`
                } catch (error) {
                  text = `${(error as { code?: string }).code ?? "CHROMIUM_INSTALL_FAILED"}: ${shortReason((error as Error).message) ?? "the browser could not be installed"}. Next step: Run /browse-doctor.`
                }
              }
            }
            await ctx.session.synthetic({ sessionID, text, description: "Browse install browser", resume: false })
          },
        }),
      )
      // The person's Chrome, per task (issue #3): under jelly, in real mode, no browse tool reaches the server for a
      // session the person has not allowed. Managed mode drives its own Chrome for Testing, not the person's.
      const jelly = seam.jelly ?? underJelly()
      const personal = jelly && options.browser === "real"
      const gate = new ChromeGate({
        describe: async (sessionID) => (await ctx.session.get({ sessionID } as never)).title ?? "",
        ...(seam.askTimeoutMs !== undefined ? { askTimeoutMs: seam.askTimeoutMs } : {}),
      })
      let stopWatching = () => undefined as void
      if (personal) {
        await registerGate(ctx.tool, gate)
        stopWatching = watchSessions(ctx.event, gate)
      }
      await registerNativeRpc(ctx.rpc, {
        gate,
        available: () => personal && binary !== undefined && source?.type !== "conflict",
        extensionConnected: async () => {
          const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, 3_000).unref?.())
          const status = await Promise.race([read(), timeout])
          return status?.extension.connected
        },
        ...(seam.actionKey ? { key: seam.actionKey } : {}),
      })
      const stopTools = await registerToolsRpc(ctx, { methods: METHODS, mcp: { server: SERVER_NAME, managed: () => source?.type !== "conflict" } })
      return async () => {
        gate.dispose()
        stopWatching()
        await managed?.stop()
        await stopTools()
      }
    },
  })
}

/** `/browse-stop-relay`: stops the relay this installation started, or says why it will not. */
export function registerStopRelayCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic"> },
  deps: { readonly binary: () => BinaryInfo | undefined; readonly stop?: typeof stopRelaySafely },
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "browse-stop-relay",
      description: "Stop the browse relay this plugin's binary started, if it is running",
      execute: async ({ sessionID }) => {
        const binary = deps.binary()
        const text = binary === undefined
          ? errorText("NOT_INSTALLED", "There is no pinned browse binary to identify the relay.", "Reinstall the plugin.")
          : formatRelayStop(await (deps.stop ?? stopRelaySafely)({ expectedVersion: PINNED_VERSION, binaryPath: binary.path }))
        await ctx.session.synthetic({ sessionID, text, description: "Browse stop relay", resume: false })
      },
    }),
  )
}

export { runBinary }
export type { Status }
