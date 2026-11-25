// The slash commands the plugin adds: /browse-status, /browse-doctor, /browse-install, /browse-install-browser and
// /browse-stop-relay. They are host surfaces, not contract methods: they print a report into the session and never
// drive the browser.
import type { Plugin } from "@opencode/plugin"
import { rulesFor, unguardedAgents as missingAgents } from "@we-the-rebel-alliance/plugin-contract/access"
import { redactReason } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { errorText, PINNED_VERSION } from "./constants.js"
import type { BrowseProvider } from "./provider/index.js"
import { parseJsonOutput, resolveBinary, runBinary, type BinaryInfo, type BrowseStatus, type ScopeResult } from "./provider/binary.js"
import type { ManagedStatus } from "./provider/managed.js"
import { formatRelayStop, stopRelaySafely } from "./provider/relay.js"
import { formatRecording, recordingNextStep, type RecordingReadiness } from "./provider/recording.js"
import { formatReport, type HostCheck } from "./report.js"
import { agentRules } from "./report-build.js"
import { shortReason } from "./redact.js"

export interface CommandContext {
  readonly command: Pick<Plugin.Context["command"], "transform">
  readonly session: Pick<Plugin.Context["session"], "synthetic">
  readonly agent: Pick<Plugin.Context["agent"], "list">
}

/** The agents that lack the generated rules, asked from a command (a handler asks its own call instead). */
async function guarded(ctx: CommandContext, manifest: Manifest, provider: BrowseProvider): Promise<{ agents: readonly string[]; problem?: string }> {
  try {
    const agents = (await ctx.agent.list()).data
    return { agents: missingAgents(agents, rulesFor(manifest, provider.options?.access ?? "all")) }
  } catch (error) {
    return { agents: [], problem: `UNAVAILABLE: the agent list could not be read (${redactReason(error instanceof Error ? error.message : String(error))}).` }
  }
}

/** The report and its text, as the status command and the dialog show it. */
async function readReport(ctx: CommandContext, manifest: Manifest, provider: BrowseProvider) {
  const agents = await guarded(ctx, manifest, provider)
  return provider.report(agents.agents, agents.problem === undefined ? [] : [agents.problem])
}

export function registerStatusCommand(ctx: CommandContext, manifest: Manifest, provider: BrowseProvider) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "browse-status",
      description: "Show Browse's mode, binary, relay, extension, scope, tools and the next step",
      execute: async ({ sessionID }) => {
        const text = await readReport(ctx, manifest, provider).then(
          (report) => {
            const lines = formatReport(report)
            return report.unguardedAgents.length === 0 ? lines : `${lines}\n\nThe default rules to paste into each listed agent:\n${agentRules(manifest, report.accessMode)}`
          },
          (cause: unknown) => {
            const reason = shortReason(cause instanceof Error ? cause.message : String(cause))
            return errorText("STATUS_UNAVAILABLE", `Could not read Browse's status${reason ? ` (${reason})` : ""}.`, "Restart OpenCode, then run /browse-status again.")
          },
        )
        await ctx.session.synthetic({ sessionID, text, description: "Browse status", resume: false })
      },
    }),
  )
}

export interface DoctorInput {
  readonly binary?: BinaryInfo
  readonly managed?: ManagedStatus
  readonly recording?: RecordingReadiness
  readonly host: HostCheck
  readonly live: { readonly status?: BrowseStatus; readonly reason?: string }
  readonly scope?: BrowseProvider["scope"]
  readonly scopeResult?: ScopeResult
  readonly problems: readonly string[]
}

/** The vendor doctor's shape, read defensively: its checks are advisory here. */
interface VendorDoctor {
  readonly status?: string
  readonly cli?: { readonly version?: string }
  readonly relay?: { readonly reachable?: boolean; readonly version?: string; readonly buildMatches?: boolean | null; readonly error?: string | null }
  readonly extension?: { readonly connected?: boolean; readonly version?: string | null; readonly protocolCompatible?: boolean | null; readonly protocolVersion?: number | null; readonly error?: string | null }
  readonly checks?: readonly { readonly label?: string; readonly status?: string; readonly message?: string }[]
  readonly recommendations?: readonly string[]
}

function vendorLines(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return []
  const report = raw as VendorDoctor
  const lines: string[] = []
  const checks = Array.isArray(report.checks) ? report.checks : []
  for (const check of checks.slice(0, 20)) {
    if (typeof check !== "object" || check === null) continue
    const label = typeof check.label === "string" ? shortReason(check.label) : undefined
    const message = typeof check.message === "string" ? shortReason(check.message) : undefined
    if (!label) continue
    lines.push(`  ${check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗"} ${label}${message ? `: ${message}` : ""}`)
  }
  const recommendations = (Array.isArray(report.recommendations) ? report.recommendations : []).flatMap((entry) => {
    const text = typeof entry === "string" ? shortReason(entry) : undefined
    return text ? [text] : []
  })
  if (recommendations.length) lines.push(`  Vendor next steps: ${recommendations.slice(0, 3).join(" ")}`)
  return lines
}

/** The one text `/browse-doctor` prints. Pure, so a test can drive every branch without a process. */
export function renderDoctor(input: DoctorInput, vendor?: unknown): string {
  const { binary, live, scope, scopeResult } = input
  const lines = ["Browse doctor"]
  if (binary === undefined) {
    lines.push("- Binary: none", "- Next step: Run /browse-install, then restart OpenCode.")
    return lines.join("\n")
  }
  lines.push(`- Binary: ${binary.path}`)
  lines.push(
    `  browse ${binary.version ?? "unknown version"} · ${binary.verified ? "verified against its manifest" : "unverified (not the packaged binary)"} · ${
      binary.tested ? `the pinned ${PINNED_VERSION}` : `not the pinned ${PINNED_VERSION}`
    } · ${binary.platform}`,
  )
  if (input.recording !== undefined) lines.push(`- Recording: ${formatRecording(input.recording)}`)
  lines.push(`- Relay: ${live.status ? (live.status.relay.running ? `running${live.status.relay.version ? ` · ${live.status.relay.version}` : ""}${live.status.relay.stale ? " · stale build" : ""} · auto-update off` : "stopped") : `unknown (${live.reason ?? "no answer"})`}`)
  if (live.status?.relay.running) lines.push("- Stop relay: /browse-stop-relay")
  lines.push(
    `- Extension: ${
      live.status
        ? live.status.extension.connected
          ? `connected${live.status.extension.version ? ` · ${live.status.extension.version}` : ""}${live.status.extension.protocolCompatible === false ? " · protocol incompatible" : ""}`
          : `not connected${live.status.extension.pairingState ? ` (${live.status.extension.pairingState})` : ""}`
        : "unknown"
    }`,
  )
  if (input.managed !== undefined) {
    const managed = input.managed
    const chromium = managed.chromium.path === null
      ? `none${managed.chromiumPin ? ` (pinned Chrome for Testing ${managed.chromiumPin.version}${managed.chromiumPin.supported ? "" : ", no build for this platform"})` : ""}`
      : `Chrome for Testing ${managed.chromium.version} (${managed.chromium.verified ? "verified" : "unverified, your own"}; ${managed.chromium.source})`
    lines.push(`- Mode: managed browser · ${managed.state}${managed.pid === null ? "" : ` · pid ${managed.pid}`}${managed.headless ? " · headless" : " · headed"}`)
    lines.push(`  ${chromium} · extension ${managed.extension.version ?? "unknown"} · profile ${managed.profile}`)
    if (managed.lastError) lines.push(`  Last error: ${managed.lastError}`)
    if (managed.state !== "running") lines.push(`- Install browser: /browse-install-browser (asks nothing; it downloads and verifies the pinned Chrome for Testing)`)
  } else {
    lines.push("- Mode: real browser (the Web Store extension)")
    if (!live.status?.extension.connected) lines.push(`- Pair: "${binary.path}" pair`)
  }
  if (scope) {
    const state = scopeResult === undefined ? "not prepared" : scopeResult.changed ? scopeResult.action : `ready (${scopeResult.action})`
    lines.push(`- Scope: ${scope.session}${scope.readOnly ? " (read-only)" : ""}${scope.allowedOrigins.length ? ` · ${scope.allowedOrigins.join(", ")}` : " · no allowlist"} · ${state}`)
  }
  lines.push(...vendorLines(vendor))
  if (input.problems.length) lines.push(`- Problems: ${input.problems.join(" ")}`)
  lines.push(`- OpenCode: ${input.host.version ?? "unknown version"} (${input.host.tested ? "tested" : "untested"}; supported range ${input.host.range})`)
  lines.push(`- Next step: ${nextStep(input, live, scopeResult)}`)
  return lines.join("\n")
}

function nextStep(input: DoctorInput, live: DoctorInput["live"], scopeResult: ScopeResult | undefined): string {
  if (input.binary === undefined) return "Run /browse-install, then restart OpenCode."
  if (input.binary.source === "option") return "The binary is your own path option, not the packaged one; remove \"path\" to use the pinned release."
  if (!input.binary.tested) return `The binary is not the pinned ${PINNED_VERSION}; update the plugin.`
  if (scopeResult?.changed) return scopeResult.action[0]?.toUpperCase() + scopeResult.action.slice(1) + "."
  const recording = recordingNextStep(input.recording)
  if (recording) return recording
  if (input.managed?.state === "not_installed") return "Run /browse-install-browser to download and verify the pinned Chrome for Testing."
  if (input.managed?.state === "failed") return `The managed browser failed: ${input.managed.lastError ?? "see the browser log"}. Run /browse-doctor again after fixing it.`
  if (input.managed?.state === "starting") return "The managed browser is starting; run /browse-doctor again in a few seconds."
  if (input.scope && scopeResult === undefined) return `Run /browse-doctor again to prepare session "${input.scope.session}", or pair the browser first with \`browse pair\`.`
  if (!live.status) return `Run \`${input.binary.path} status\` in a terminal and fix what it reports.`
  if (!live.status.relay.running) return "Ask the agent to open a page, which starts the relay."
  if (!live.status.extension.connected) {
    if (live.status.extension.nextStep) return live.status.extension.nextStep
    return "Pair the browse extension: run `browse pair`, then enter the code on the extension's options page."
  }
  return "Nothing to do."
}

export function registerDoctorCommand(ctx: CommandContext, provider: BrowseProvider) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "browse-doctor",
      description: "Check Browse's binary, relay, extension and scope, and repair the pinned session",
      execute: async ({ sessionID }) => {
        const binary = provider.binary
        let vendor: unknown
        const problems = [...provider.problems()]
        if (binary !== undefined) {
          const result = await runBinary(binary.path, ["doctor", "--json"], { timeoutMs: 30_000 })
          vendor = parseJsonOutput(result.stdout)
          if (result.code !== 0) problems.push(errorText("DOCTOR_FAILED", "The vendor doctor exited non-zero.", "Read its checks above, fix the first failing one, then run /browse-doctor again."))
        }
        let scopeResult: ScopeResult | undefined
        if (provider.scope !== undefined) scopeResult = await provider.applyScope(true).catch(() => undefined)
        const text = renderDoctor(
          {
            ...(binary ? { binary } : {}),
            host: provider.host,
            live: await provider.live(true),
            ...(provider.scope ? { scope: provider.scope } : {}),
            ...(provider.managed ? { managed: provider.managed.status() } : {}),
            ...(provider.recording ? { recording: provider.recording } : {}),
            ...(scopeResult ? { scopeResult } : {}),
            problems,
          },
          vendor,
        )
        await ctx.session.synthetic({ sessionID, text, description: "Browse doctor", resume: false })
      },
    }),
  )
}

/** The two install commands: the pinned binary, and Chrome for Testing for managed mode. */
export function registerInstallCommands(ctx: CommandContext, provider: BrowseProvider) {
  const install = ctx.command.transform((editor) =>
    editor.add({
      name: "browse-install",
      description: "Download and verify the pinned browse binary (about 115-135 MB), then restart OpenCode",
      execute: async ({ sessionID }) => {
        let text: string
        const options = provider.options
        if (options?.path !== undefined) {
          text = "This plugin uses the browse binary named by the path option, so there is nothing to download. Remove the path option to use the pinned release."
        } else {
          try {
            const info = await resolvePinned(options?.verifyBinary !== false)
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
  const installBrowser = ctx.command.transform((editor) =>
    editor.add({
      name: "browse-install-browser",
      description: "Download and verify Chrome for Testing for managed mode (about 195-210 MB), then start it",
      execute: async ({ sessionID }) => {
        let text: string
        if (provider.managed === undefined) {
          text = "Managed mode is off. Set \"browser\": \"managed\" in this plugin's options, restart OpenCode, then run /browse-install-browser."
        } else {
          const before = provider.managed.status()
          if (before.state === "running") {
            text = "The managed browser is already running."
          } else {
            try {
              await provider.managed.installAndStart()
              const after = provider.managed.status()
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
  return Promise.all([install, installBrowser])
}

/** Downloads and verifies the pinned binary on demand; the install command uses the full policy (it may download). */
const resolvePinned = (verify: boolean): Promise<BinaryInfo> => resolveBinary({ verify, mayDownload: () => undefined })

/** `/browse-stop-relay`: stops the relay this installation started, or says why it will not. */
export function registerStopRelayCommand(
  ctx: CommandContext,
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

