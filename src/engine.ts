// The pinned browse binary: where it is, whether it is the one we ship, what version it answers, and the few CLI
// calls status and the scoped session need. No installer, no update, no pairing, no PATH lookup: a dependency named
// `browse` in a project must never drive the user's browser. The only binary this plugin runs is the one in its
// platform package, or a path the user set explicitly.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { browseError, PINNED_VERSION } from "./constants.js"
import type { ScopeOptions } from "./options.js"

export type PlatformKey = "darwin-arm64" | "darwin-x64" | "linux-x64-gnu" | "linux-arm64-gnu"

/** The platform packages the release publishes, and the key each is built for. */
export const PACKAGE_FOR: Readonly<Record<PlatformKey, string>> = {
  "darwin-arm64": "@joe-broadhead/opencode-browse-bin-darwin-arm64",
  "darwin-x64": "@joe-broadhead/opencode-browse-bin-darwin-x64",
  "linux-x64-gnu": "@joe-broadhead/opencode-browse-bin-linux-x64-gnu",
  "linux-arm64-gnu": "@joe-broadhead/opencode-browse-bin-linux-arm64-gnu",
}

export function platformKey(platform: string = process.platform, arch: string = process.arch): PlatformKey | undefined {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64"
  if (platform === "darwin" && arch === "x64") return "darwin-x64"
  if (platform === "linux" && arch === "x64") return "linux-x64-gnu"
  if (platform === "linux" && arch === "arm64") return "linux-arm64-gnu"
  return undefined
}

export const platformLabel = (platform: string = process.platform, arch: string = process.arch) => `${platform}-${arch}`

/** The binary's name inside a platform package. */
export const BINARY_NAME = process.platform === "win32" ? "browse.exe" : "browse"

/** What a platform package's manifest/browse.json records about the binary it ships. */
export interface BinaryManifest {
  readonly version: string
  readonly sha256: string
  readonly bytes: number
  readonly target: string
  readonly upstream: string
  readonly licence: string
}

export type Source = "package" | "option" | "environment"

export interface BinaryInfo {
  readonly path: string
  readonly version: string | null
  readonly source: Source
  readonly verified: boolean
  readonly platform: string
  readonly supported: boolean
  /** True only for the release this plugin pins and ships. */
  readonly pinned: boolean
  /** True when the version is the pinned one (known for a packaged binary without running it). */
  readonly tested: boolean
}

export interface ResolveInput {
  readonly optionPath?: string
  readonly verify?: boolean
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: string
  readonly arch?: string
  /** Where to resolve the platform packages from; the installed package by default, a test's folder in a unit test. */
  readonly packageRoot?: string
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** A digest cache keyed by path, size and mtime, so status never hashes 115 MB twice. */
const digests = new Map<string, { key: string; digest: string }>()
function fileDigest(path: string): string {
  const stat = statSync(path)
  const key = `${stat.size}:${stat.mtimeMs}`
  const cached = digests.get(path)
  if (cached?.key === key) return cached.digest
  const digest = sha256(path)
  digests.set(path, { key, digest })
  return digest
}

function packageBinary(key: PlatformKey, packageRoot?: string): { path: string; manifest: BinaryManifest } | undefined {
  try {
    const dir = packageRoot === undefined
      ? dirname(createRequire(import.meta.url).resolve(`${PACKAGE_FOR[key]}/package.json`))
      : join(packageRoot, "node_modules", "@joe-broadhead", `opencode-browse-bin-${key}`)
    return { path: join(dir, "bin", BINARY_NAME), manifest: JSON.parse(readFileSync(join(dir, "manifest", "browse.json"), "utf8")) as BinaryManifest }
  } catch {
    return undefined
  }
}

/**
 * Finds the binary, in order: the `path` option (the user's own), the platform package the release pins, then the
 * `OPENCODE_BROWSE_BIN` test seam. There is deliberately no PATH fallback. A packaged binary whose SHA-256 differs
 * from its manifest is refused with BINARY_UNVERIFIED before anything runs.
 */
export function resolveBinary(input: ResolveInput = {}): BinaryInfo {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const key = platformKey(platform, arch)
  const env = input.env ?? process.env
  const verify = input.verify ?? true
  const candidate = (path: string, source: Source, version: string | null, verified: boolean): BinaryInfo => ({
    path,
    version,
    source,
    verified,
    platform: platformLabel(platform, arch),
    supported: key !== undefined,
    pinned: version === PINNED_VERSION && source === "package",
    tested: version === PINNED_VERSION,
  })

  if (input.optionPath !== undefined) {
    const path = resolve(input.optionPath)
    if (!existsSync(path)) {
      throw browseError("BINARY_MISSING", `The path option points at ${path}, which does not exist.`, "Set \"path\" to a browse binary, or remove it to use the pinned one.")
    }
    return candidate(path, "option", null, false)
  }

  if (key !== undefined) {
    const found = packageBinary(key, input.packageRoot)
    if (found !== undefined && existsSync(found.path)) {
      if (verify && fileDigest(found.path) !== found.manifest.sha256) {
        throw browseError(
          "BINARY_UNVERIFIED",
          "The browse binary does not match the SHA-256 its platform package records, so it was not run.",
          "Reinstall the plugin; if it still fails, set \"verifyBinary\": false only if you trust that file.",
        )
      }
      return candidate(found.path, "package", found.manifest.version, verify)
    }
  }

  const fromEnv = env.OPENCODE_BROWSE_BIN
  if (fromEnv !== undefined && fromEnv !== "") {
    const path = resolve(fromEnv)
    if (!existsSync(path)) throw browseError("BINARY_MISSING", "OPENCODE_BROWSE_BIN points at a file that does not exist.", "Unset it, or point it at a browse binary.")
    return candidate(path, "environment", null, false)
  }

  throw browseError(
    key === undefined ? "UNSUPPORTED_PLATFORM" : "BINARY_MISSING",
    key === undefined
      ? `This plugin ships no browse binary for ${platformLabel(platform, arch)}.`
      : "The pinned browse binary is missing from its platform package.",
    key === undefined
      ? "Use macOS (arm64 or x64) or Linux (x64 or arm64), or set the \"path\" option to your own browse binary."
      : "Reinstall the plugin, so the platform package for this computer is installed.",
  )
}

/** The semantic version in `browse X.Y.Z` or a bare `X.Y.Z`; a suffix such as `-dev.1` is ignored. */
export function parseVersion(output: string): string | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output)
  return match === null ? undefined : `${match[1]}.${match[2]}.${match[3]}`
}

export interface Probe {
  readonly version: string | null
  /** True only for the pinned release. */
  readonly tested: boolean
}

/** Runs `browse --version` once. A binary that cannot answer is untested, never assumed good. */
export function probeVersion(bin: string, timeoutMs = 5_000): Promise<Probe> {
  return new Promise((resolveProbe) => {
    execFile(bin, ["--version"], { timeout: timeoutMs, env: { ...process.env }, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) return resolveProbe({ version: null, tested: false })
      const version = parseVersion(stdout) ?? null
      resolveProbe({ version, tested: version === PINNED_VERSION })
    })
  })
}

export interface RunResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

/** Runs the pinned binary with an argument list, never a shell, with a timeout. */
export function runBinary(bin: string, args: readonly string[], options: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolveRun) => {
    execFile(
      bin,
      [...args],
      { timeout: options.timeoutMs ?? 15_000, cwd: options.cwd, env: options.env ?? { ...process.env }, maxBuffer: 8 << 20 },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error && "killed" in error && error.killed === true)
        resolveRun({ code: error && typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : error ? null : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), timedOut })
      },
    )
  })
}

/** The subset of `browse status --json` this plugin reads. Every field is validated before it is used. */
export interface BrowseStatus {
  readonly relay: { readonly running: boolean; readonly version: string | null; readonly stale: boolean }
  readonly extension: {
    readonly connected: boolean
    readonly version: string | null
    readonly pairingState: string | null
    readonly protocolCompatible: boolean | null
    readonly nextStep: string | null
  }
  readonly sessions: readonly { readonly id: string; readonly readOnly: boolean; readonly allowedOrigins: readonly string[] }[]
  readonly autoUpdate: string | null
  readonly updateAvailable: string | null
}

/** The CLI prints JSON with two-space indentation; accept one object spanning the whole output or a final line. */
export function parseJsonOutput(stdout: string): unknown {
  const whole = stdout.trim()
  if (whole === "") return undefined
  try {
    return JSON.parse(whole)
  } catch {
    const line = whole.split("\n").filter(Boolean).at(-1)
    if (line === undefined) return undefined
    try {
      return JSON.parse(line)
    } catch {
      return undefined
    }
  }
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null)

/** Parses the status envelope defensively: an absent or changed field becomes null, never a crash. */
export function parseStatus(raw: unknown): BrowseStatus | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const relay = value.relay !== null && typeof value.relay === "object" ? (value.relay as Record<string, unknown>) : {}
  const extension = value.extension !== null && typeof value.extension === "object" ? (value.extension as Record<string, unknown>) : {}
  const sessions = Array.isArray(value.sessions) ? value.sessions : []
  const update = value.update !== null && typeof value.update === "object" ? (value.update as Record<string, unknown>) : undefined
  return {
    relay: { running: bool(relay.running) === true, version: text(relay.version), stale: bool(relay.stale) === true },
    extension: {
      connected: bool(extension.connected) === true,
      version: text(extension.version),
      pairingState: text(extension.pairingState),
      protocolCompatible: bool(extension.protocolCompatible),
      nextStep: text(extension.nextStep),
    },
    sessions: sessions.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return []
      const session = entry as Record<string, unknown>
      const id = text(session.id)
      if (id === null) return []
      return [{ id, readOnly: bool(session.readOnly) === true, allowedOrigins: Array.isArray(session.allowedOrigins) ? session.allowedOrigins.filter((origin): origin is string => typeof origin === "string") : [] }]
    }),
    autoUpdate: text(value.autoUpdate),
    updateAvailable: update ? text(update.latest) ?? text(update.version) : null,
  }
}

/**
 * Reads `browse status --json`. Exit 4 with JSON on stdout is the relay being stopped, which is a normal state, not
 * a failure; an unparsable answer is a failure with its own reason.
 */
export async function readStatus(bin: string, timeoutMs = 10_000): Promise<{ status?: BrowseStatus; reason?: string }> {
  const result = await runBinary(bin, ["status", "--json"], { timeoutMs })
  if (result.timedOut) return { reason: "the status command timed out" }
  const raw = parseJsonOutput(result.stdout)
  if (raw === undefined) return { reason: result.stderr.trim() || "the status command printed nothing" }
  const status = parseStatus(raw)
  return status ? { status } : { reason: "the status answer had an unexpected shape" }
}

export interface ScopeResult {
  readonly changed: boolean
  readonly action: string
}

/**
 * Ensures the pinned session exists with the configured scope, and repairs a drift. Every call is the vendor CLI with
 * an argument list: `session list --json`, then `session new`, `session allow`, or a delete and new when only the
 * read-only flag differs (which browse cannot change in place).
 */
export async function ensureScope(bin: string, scope: ScopeOptions, timeoutMs = 20_000): Promise<ScopeResult> {
  const listed = await runBinary(bin, ["session", "list", "--json"], { timeoutMs })
  const parsed = parseJsonOutput(listed.stdout) as { sessions?: unknown } | undefined
  if (parsed === undefined) {
    throw browseError("SCOPE_UNREACHABLE", `browse could not list sessions${listed.stderr.trim() ? ` (${listed.stderr.trim().split("\n")[0]})` : ""}.`, "Open the browser, make sure browse is paired, then run /browse-doctor.")
  }
  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : []
  const existing = sessions.find((entry): entry is { id: string; readOnly?: boolean; allowedOrigins?: string[] } => typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === scope.session)
  const origins = [...scope.allowedOrigins]
  const sameOrigins = existing !== undefined && JSON.stringify([...(existing.allowedOrigins ?? [])].sort()) === JSON.stringify([...origins].sort())
  const sameReadOnly = existing !== undefined && (existing.readOnly === true) === scope.readOnly

  if (existing === undefined) {
    const args = ["session", "new", scope.session]
    if (scope.readOnly) args.push("--read-only")
    for (const origin of origins) args.push("--allow-origin", origin)
    const created = await runBinary(bin, args, { timeoutMs })
    if (created.code !== 0) throw scopeFailure("create", created.stderr)
    return { changed: true, action: `created session ${scope.session}` }
  }
  if (!sameReadOnly) {
    const deleted = await runBinary(bin, ["session", "delete", scope.session], { timeoutMs })
    if (deleted.code !== 0) throw scopeFailure("recreate", deleted.stderr)
    const args = ["session", "new", scope.session]
    if (scope.readOnly) args.push("--read-only")
    for (const origin of origins) args.push("--allow-origin", origin)
    const created = await runBinary(bin, args, { timeoutMs })
    if (created.code !== 0) throw scopeFailure("create", created.stderr)
    return { changed: true, action: `recreated session ${scope.session} ${scope.readOnly ? "read-only" : "read-write"}` }
  }
  if (!sameOrigins) {
    const args = ["session", "allow", "--session", scope.session, ...(origins.length ? origins : ["--clear"])]
    const allowed = await runBinary(bin, args, { timeoutMs })
    if (allowed.code !== 0) throw scopeFailure("allow", allowed.stderr)
    return { changed: true, action: origins.length ? `set ${origins.length} allowed origin(s) on ${scope.session}` : `cleared the allowlist on ${scope.session}` }
  }
  return { changed: false, action: `session ${scope.session} already matches` }
}

function scopeFailure(step: string, stderr: string) {
  const reason = stderr.trim().split("\n")[0]
  return browseError("SCOPE_UNREACHABLE", `browse could not ${step} the pinned session${reason ? ` (${reason})` : ""}.`, "Open the browser, make sure browse is paired, then run /browse-doctor and try again.")
}
