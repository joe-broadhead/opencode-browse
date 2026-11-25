// The browse provider: the pinned binary, the MCP server it serves, the managed browser, the pinned session and the
// live reads status and the doctor use. Everything here talks to browse, Chromium or the host's public APIs; the
// contract's doors are wired by `register` in ../index.ts.
import type { Plugin } from "@opencode/plugin"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { errorText, isPluginCode } from "../constants.js"
import type { Options, ParseResult, ScopeOptions } from "../options.js"
import { packageRoot } from "../package.js"
import { hostOf, type HostCheck, type Report } from "../report.js"
import { buildReport, readReport } from "../report-build.js"
import { shortReason } from "../redact.js"
import { ensureScope, probeVersion, readStatus, resolveBinary, verifyBinaryNow, type BinaryInfo, type BrowseStatus, type Probe, type ScopeResult } from "./binary.js"
import { ManagedBrowser } from "./managed.js"
import { detectRecording, type RecordingReadiness } from "./recording.js"
import { registerServer, serverCommand, serverEnvironment, type ServerSource } from "./server.js"

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

/** What setup builds once: the provider calls, the live reads and the problems status reports. */
export interface BrowseProvider {
  readonly options: Options | undefined
  readonly host: HostCheck
  readonly binary: BinaryInfo | undefined
  readonly scope: ScopeOptions | undefined
  readonly managed: ManagedBrowser | undefined
  readonly recording: RecordingReadiness | undefined
  /** The diagnostic report, with the agents the caller read from its own call. */
  readonly report: (unguardedAgents: readonly string[], extraProblems?: readonly string[]) => Promise<Report>
  readonly live: (force?: boolean) => Promise<{ status?: BrowseStatus; reason?: string }>
  readonly applyScope: (force: boolean) => Promise<ScopeResult | undefined>
  readonly problems: () => readonly string[]
  /** Records a problem found after setup, such as a transform that failed; status reports it. */
  readonly note: (problem: string | undefined) => void
  readonly dispose: () => Promise<void>
}

/**
 * Builds the provider. A bad option never throws the plugin away: it records the problem and leaves the MCP server,
 * the binary and the managed browser unset, so status and the doctor still answer (DR-4). A first-use binary download
 * runs only at access "all"; the other values refuse it and name /browse-install, which downloads at any access value.
 */
export async function createProvider(ctx: Plugin.Context, manifest: Manifest, parsed: ParseResult): Promise<BrowseProvider> {
  const host = hostOf(manifest, ctx.app.version)
  const options = parsed.ok ? parsed.options : undefined
  const level = options?.access ?? "all"
  const problems = new Map<string, string>()
  const late: string[] = []
  if (!parsed.ok) problems.set("options", parsed.problem)
  const report = (area: string) => (problem: string | undefined) => void (problem ? problems.set(area, problem) : problems.delete(area))

  let binary: BinaryInfo | undefined
  let binaryProblem: string | undefined
  let source: ServerSource | undefined
  let scopeResult: ScopeResult | undefined
  let scopeProblem: string | undefined
  let managed: ManagedBrowser | undefined
  let probe: Probe | null = null
  let recording: RecordingReadiness | undefined

  // Re-checks the resolved binary at each use: a released binary must still hash to its pin.
  const verifyBinary = (): BinaryInfo => {
    if (binary === undefined) throw new Error("the browse binary is not resolved")
    binary = verifyBinaryNow(binary, options?.verifyBinary !== false)
    return binary
  }

  /** Creates or repairs the pinned session; the doctor calls it with `force` after a repair. */
  const applyScope = async (force: boolean): Promise<ScopeResult | undefined> => {
    if (binary === undefined || options?.scope === undefined) return undefined
    if (!force && scopeResult !== undefined) return scopeResult
    try {
      verifyBinary()
      scopeResult = await ensureScope(binary.path, options.scope)
      scopeProblem = undefined
      problems.delete("scope")
      return scopeResult
    } catch (error) {
      const caught = (error as { code?: unknown }).code
      const code = isPluginCode(caught) ? caught : "SCOPE_UNREACHABLE"
      const reason = shortReason((error as Error).message.replace(/^[A-Z_]+: /, "").split(" Next step: ")[0] ?? "") ?? "the pinned session could not be prepared"
      scopeProblem = errorText(code, reason, (error as { nextStep?: string }).nextStep ?? "Run /browse-doctor.")
      problems.set("scope", scopeProblem)
      throw error
    }
  }

  if (options !== undefined) {
    const firstUse = (): void => {
      if (options.access !== "all") {
        throw new Error(errorText("BINARY_MISSING", "The browse binary is not installed, and access does not allow a first-use download.", "Run /browse-install, then restart OpenCode."))
      }
    }
    try {
      binary = await resolveBinary({ ...(options.path ? { optionPath: options.path } : {}), verify: options.verifyBinary, mayDownload: firstUse })
    } catch (error) {
      const caught = (error as { code?: unknown }).code
      const code = isPluginCode(caught) ? caught : "BINARY_MISSING"
      const message = (error as Error).message.replace(/^[A-Z_]+: /, "").split(" Next step: ")[0] ?? "the browse binary could not be resolved."
      const next = (error as { nextStep?: string }).nextStep ?? "Reinstall the plugin."
      binaryProblem = errorText(code, message, next)
      problems.set("binary", binaryProblem)
    }

    await registerServer(
      ctx.mcp,
      binary === undefined ? undefined : { command: serverCommand(binary), environment: serverEnvironment(options) },
      (next, problem) => {
        source = next
        report("server")(problem)
      },
    )

    if (binary !== undefined && options.scope !== undefined) await applyScope(false).catch(() => undefined)

    // Managed mode: a separate Chromium and profile, started in the background and stopped on dispose.
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

    if (binary !== undefined) void probeVersion(binary.path).then((result) => (probe = result))
  }

  // Recording readiness: ffmpeg for agent-opened tabs, and the toolbar-click backend that needs nothing.
  void detectRecording().then((result) => (recording = result))
  const live = cachedLive(binary?.path, 10_000)

  const reportOf = async (unguardedAgents: readonly string[], extraProblems: readonly string[] = []): Promise<Report> => {
    const all = [...problems.values(), ...late, ...extraProblems]
    if (binary === undefined) {
      return buildReport(manifest, {
        host,
        level,
        mode: options?.browser ?? "real",
        ...(binaryProblem ? { binaryProblem } : {}),
        ...(source ? { source } : {}),
        ...(scopeProblem ? { scopeProblem } : {}),
        problems: all,
        ...(recording ? { recording } : {}),
        unguardedAgents,
        binary: { path: null, version: null, source: null, verified: false, tested: false, supported: false },
      })
    }
    return readReport(manifest, ctx, {
      host,
      level,
      mode: options?.browser ?? "real",
      binary,
      ...(source ? { source } : {}),
      probe,
      ...(options?.scope ? { scope: { session: options.scope.session, readOnly: options.scope.readOnly, allowedOrigins: options.scope.allowedOrigins, matches: false } } : {}),
      ...(scopeProblem ? { scopeProblem } : {}),
      problems: all,
      ...(recording ? { recording } : {}),
      unguardedAgents,
      live: () => live(),
      managed: () => managed?.status(),
    })
  }

  return {
    options,
    host,
    binary,
    scope: options?.scope,
    managed,
    recording,
    report: reportOf,
    live: (force = false) => live(force),
    applyScope,
    problems: () => [...problems.values(), ...late],
    note: (problem) => void (problem !== undefined && late.push(problem)),
    async dispose() {
      await managed?.stop()
    },
  }
}
