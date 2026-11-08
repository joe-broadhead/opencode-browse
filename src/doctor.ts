import type { Plugin } from "@opencode/plugin"
import { errorText, PINNED_VERSION, SERVER_NAME } from "./constants.js"
import { parseJsonOutput, runBinary, type BinaryInfo, type BrowseStatus, type ScopeResult } from "./engine.js"
import type { ScopeOptions } from "./options.js"
import type { ManagedStatus } from "./managed/browser.js"
import { formatRecording, recordingNextStep, type RecordingReadiness } from "./recording.js"
import { shortReason } from "./redact.js"
import type { HostCheck } from "./host-version.js"

export interface DoctorInput {
  readonly binary?: BinaryInfo
  readonly managed?: ManagedStatus
  readonly recording?: RecordingReadiness
  readonly host: HostCheck
  readonly live: { readonly status?: BrowseStatus; readonly reason?: string }
  readonly scope?: ScopeOptions
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
    lines.push("- Binary: none", "- Next step: Reinstall the plugin so its platform package is installed.")
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
  const problems = input.problems.filter((problem) => !problem.startsWith("RULES_NOT_ADDED"))
  if (problems.length) lines.push(`- Problems: ${problems.join(" ")}`)
  lines.push(`- OpenCode: ${input.host.version ?? "unknown version"} (${input.host.tested ? "tested" : "untested"}; supported range ${input.host.range})`)
  lines.push(`- Next step: ${nextStep(input, live, scopeResult)}`)
  return lines.join("\n")
}

function nextStep(input: DoctorInput, live: DoctorInput["live"], scopeResult: ScopeResult | undefined): string {
  if (input.binary === undefined) return "Reinstall the plugin so its platform package is installed."
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

export interface DoctorDeps {
  readonly binary: () => BinaryInfo | undefined
  readonly managed: () => ManagedStatus | undefined
  readonly recording: () => RecordingReadiness | undefined
  readonly installBrowser: () => Promise<{ message: string }>
  readonly live: () => Promise<{ status?: BrowseStatus; reason?: string }>
  readonly scope: () => ScopeOptions | undefined
  readonly applyScope: (force: boolean) => Promise<ScopeResult | undefined>
  readonly problems: () => readonly string[]
  readonly host: HostCheck
}

/** `/browse-doctor`: runs the vendor `doctor --json` plus this plugin's own checks, and repairs the pinned session. */
export function registerDoctorCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic">; readonly app: Pick<Plugin.Context["app"], "version"> },
  deps: DoctorDeps,
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "browse-doctor",
      description: "Check Browse's binary, relay, extension and scope, and repair the pinned session",
      execute: async ({ sessionID }) => {
        const binary = deps.binary()
        let vendor: unknown
        const problems = [...deps.problems()]
        if (binary !== undefined) {
          const result = await runBinary(binary.path, ["doctor", "--json"], { timeoutMs: 30_000 })
          vendor = parseJsonOutput(result.stdout)
          if (result.code !== 0) problems.push(errorText("DOCTOR_FAILED", "The vendor doctor exited non-zero.", "Read its checks above, fix the first failing one, then run /browse-doctor again."))
        }
        let scopeResult: ScopeResult | undefined
        if (deps.scope() !== undefined) scopeResult = await deps.applyScope(true).catch(() => undefined)
        const text = renderDoctor(
          {
            ...(binary ? { binary } : {}),
            host: deps.host,
            live: await deps.live(),
            ...(deps.scope() ? { scope: deps.scope() } : {}),
            ...(deps.managed() ? { managed: deps.managed() } : {}),
            ...(deps.recording() ? { recording: deps.recording() } : {}),
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

export const DOCTOR_COMMAND = "browse-doctor"
export const serverName = SERVER_NAME
