// Managed mode: a separate Chromium with its own profile, browse's extension loaded unpacked, paired with our relay
// through browse's own pairing protocol. The user's own browser is never touched.
//
// Pairing: `browse pair` mints a one-time code at the relay and waits; the code is written to the extension copy's
// `relay-pairing.json`, which browse's unpacked build reads and exchanges for its own key. That is exactly the
// mechanism browse's installer uses for an unpacked build. This plugin never mints, guesses or bypasses a code.
import { spawn, execFile } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { browseError } from "../constants.js"
import { shortReason } from "../redact.js"
import { installChromium, managedPlatform, readPin, resolveChromium, type ChromiumInfo } from "./chromium.js"
import { clearPairingCode, prepareExtension, readExtensionPin, writePairingCode, type ExtensionPin } from "./extension.js"
import { relayVersion, stopManagedRelay } from "./relay.js"
import { extensionDir, managedRoot, profileDir, relayPort, relayTokenPath, statePath } from "./paths.js"

export type ManagedState = "stopped" | "starting" | "running" | "not_installed" | "failed"

export interface ManagedStatus {
  readonly mode: "managed"
  readonly state: ManagedState
  readonly chromium: { readonly path: string | null; readonly version: string | null; readonly source: "installed" | "option" | null; readonly verified: boolean }
  readonly chromiumPin: { readonly version: string; readonly supported: boolean; readonly bytes?: number } | undefined
  readonly extension: { readonly version: string | null; readonly directory: string | null }
  readonly profile: string
  readonly pid: number | null
  readonly headless: boolean
  readonly lastError: string | null
}

export interface ManagedOptions {
  readonly chromiumPath?: string
  readonly headless: boolean
  /** Where manifest/chromium.json and managed-extension/ live: the package root. */
  readonly packageRoot: string
  /** The pinned browse binary; managed mode runs its `pair` and `status`. */
  readonly binary: string
  /** Re-verifies the pinned binary at every spawn; throws BINARY_UNVERIFIED when it changed. */
  readonly verify?: () => unknown
  readonly platform?: ReturnType<typeof managedPlatform>
}

interface BrowserRecord {
  readonly pid: number
  readonly executable: string
  readonly startedAt: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The relay's extension status, read with browse's own token. No code, token or page URL leaves this function. */
async function extensionConnected(timeoutMs = 800): Promise<boolean> {
  let token: string
  try {
    token = readFileSync(relayTokenPath(), "utf8").trim()
  } catch {
    return false
  }
  try {
    const response = await fetch(`http://127.0.0.1:${relayPort()}/extension/status`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const body = (await response.json()) as { connected?: unknown }
    return body.connected === true
  } catch {
    return false
  }
}

/** True when the process is our browser: its command line names the executable we launched. */
function isOurProcess(pid: number, executable: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "command="], { timeout: 2_000 }, (error, stdout) => {
      resolve(!error && String(stdout).includes(executable))
    })
  })
}

export class ManagedBrowser {
  private child: ReturnType<typeof spawn> | undefined
  private pairChild: ReturnType<typeof spawn> | undefined
  /** The relay this start found already running, if any: only a relay we started is stopped on dispose. */
  private relayBefore: Awaited<ReturnType<typeof relayVersion>>
  /** Set by stop(): an in-flight start must not leave a browser or a relay behind. */
  private disposed = false
  private state: ManagedState = "stopped"
  private chromium: ChromiumInfo | undefined
  private extensionVersion: string | undefined
  private lastError: string | undefined
  private starting: Promise<void> | undefined
  private readonly pin: ExtensionPin

  private readonly options: ManagedOptions

  private readonly manifestDir: string

  constructor(options: ManagedOptions) {
    this.options = options
    this.manifestDir = join(options.packageRoot, "manifest")
    this.pin = readExtensionPin(this.manifestDir)
  }

  status(): ManagedStatus {
    return {
      mode: "managed",
      state: this.state,
      chromium: {
        path: this.chromium?.path ?? null,
        version: this.chromium?.version ?? null,
        source: this.chromium?.source ?? null,
        verified: this.chromium?.verified ?? false,
      },
      chromiumPin: (() => {
        try {
          const pin = readPin(this.manifestDir)
          const platform = this.options.platform ?? managedPlatform()
          return { version: pin.version, supported: platform !== undefined && pin.platforms[platform] !== undefined, ...(platform && pin.platforms[platform] ? { bytes: pin.platforms[platform]!.bytes } : {}) }
        } catch {
          return undefined
        }
      })(),
      extension: { version: this.extensionVersion ?? this.pin.version, directory: existsSync(extensionDir()) ? extensionDir() : null },
      profile: profileDir(),
      pid: this.child?.pid ?? null,
      headless: this.options.headless,
      lastError: this.lastError ?? null,
    }
  }

  /** Idempotent: a second call joins the first. Never throws; a failure is the state and `lastError`. */
  start(): Promise<void> {
    this.disposed = false
    if (this.starting !== undefined && this.state === "starting") return this.starting
    if (this.state === "running") return Promise.resolve()
    this.starting = this.launch().catch((error: unknown) => {
      this.fail(error)
    })
    return this.starting
  }

  /** Installs Chrome for Testing now (the user asked), then starts. */
  async installAndStart(): Promise<void> {
    const platform = this.options.platform ?? managedPlatform()
    if (platform === undefined) throw browseError("CHROMIUM_UNSUPPORTED", "There is no Chrome for Testing build for this platform.", "Set \"chromiumPath\" to a Chromium binary you have.")
    await installChromium(this.manifestDir, platform)
    this.starting = undefined
    await this.start()
  }

  private fail(error: unknown) {
    this.state = "failed"
    this.lastError = shortReason(error instanceof Error ? error.message : String(error))
    this.starting = undefined
    this.stopChild()
    void this.stopOwnRelay()
  }

  /** Stops the relay this start began, never one that was already running, and never a user's own. */
  private async stopOwnRelay() {
    if (this.relayBefore !== undefined) return
    const running = await relayVersion()
    if (running?.managed === true && running.instanceId) await stopManagedRelay(running.instanceId, running.buildId ?? "")
  }

  private async launch(): Promise<void> {
    if (this.state === "running" && this.child !== undefined && this.child.exitCode === null) return
    this.state = "starting"
    this.lastError = undefined
    await this.clearStale()

    // The Chromium: the user's explicit path, or the pinned CfT. Missing CfT is a state, not an error: status says
    // which command installs it.
    try {
      this.chromium = await resolveChromium(this.manifestDir, { ...(this.options.chromiumPath ? { chromiumPath: this.options.chromiumPath } : {}), ...(this.options.platform ? { platform: this.options.platform } : {}) })
    } catch (error) {
      this.fail(error)
      return
    }
    if (this.chromium === undefined) {
      this.state = "not_installed"
      return
    }

    let extension: string
    try {
      extension = prepareExtension(this.options.packageRoot, this.pin)
    } catch (error) {
      this.fail(error)
      return
    }
    this.extensionVersion = this.pin.version
    mkdirSync(profileDir(), { recursive: true })

    // A relay that is already running is someone else's (the user's own, or another session's); one that is not is
    // started by `browse pair` below, and managed mode stops it again on dispose.
    this.relayBefore = await relayVersion()

    // browse's own pairing: a one-time code at the relay, handed to the unpacked extension's startup file.
    const pairing = await this.mintCode()
    if (this.disposed) {
      pairing?.stop()
      await this.stopOwnRelay()
      return
    }
    if (pairing === undefined) return
    try {
      writePairingCode(extension, pairing.code)
    } catch (error) {
      pairing.stop()
      this.fail(error)
      return
    }

    this.launchBrowser(extension)
    if (this.disposed) {
      pairing.stop()
      this.stopChild()
      await this.stopOwnRelay()
      return
    }
    const connected = await this.waitForConnection(60_000)
    pairing.stop()
    clearPairingCode(extension)

    if (!connected) {
      this.stopChild()
      this.state = "failed"
      this.lastError = "the managed browser started but its extension never connected to the relay"
      return
    }
    this.state = "running"
  }

  private launchBrowser(extension: string) {
    const chromium = this.chromium!
    const log = (() => {
      try {
        mkdirSync(managedRoot(), { recursive: true })
        return openSync(join(managedRoot(), "browser.log"), "a", 0o600)
      } catch {
        return "ignore" as const
      }
    })()
    const args = [
      `--user-data-dir=${profileDir()}`,
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-component-update",
      "--disable-sync",
      "--disable-background-networking",
      ...(this.options.headless ? ["--headless=new"] : []),
      "about:blank",
    ]
    const child = spawn(chromium.path, args, { detached: false, stdio: ["ignore", log, log] })
    this.child = child
    child.once("exit", () => {
      if (this.child !== child) return
      this.child = undefined
      if (this.state === "running") this.state = "stopped"
      rmSync(statePath(), { force: true })
    })
    child.once("error", (error) => this.fail(error))
    mkdirSync(managedRoot(), { recursive: true })
    const record: BrowserRecord = { pid: child.pid ?? -1, executable: chromium.path, startedAt: new Date().toISOString() }
    writeFileSync(statePath(), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  }

  /**
   * Runs `browse pair`, which starts the relay and mints the code, and returns the code with a stop function. The
   * output is piped, never forwarded: the code must not reach a log or a transcript.
   */
  private async mintCode(): Promise<{ code: string; stop: () => void } | undefined> {
    try {
      this.options.verify?.()
    } catch (error) {
      this.fail(error)
      return undefined
    }
    const env = { ...process.env, OPENCODE_BROWSER_MCP_DIRECT: "1", OPENCODE_BROWSER_AUTO_UPDATE: "off" }
    const child = spawn(this.options.binary, ["pair", "--wait-seconds", "120"], { env, stdio: ["ignore", "pipe", "pipe"] })
    this.pairChild = child
    child.once("exit", () => {
      if (this.pairChild === child) this.pairChild = undefined
    })
    const stop = () => {
      if (child.exitCode === null) child.kill("SIGTERM")
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL")
      }, 2_000).unref()
      if (this.pairChild === child) this.pairChild = undefined
    }
    const code = await new Promise<string | undefined>((resolve) => {
      let output = ""
      const timer = setTimeout(() => {
        stop()
        resolve(undefined)
      }, 20_000)
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8")
        const match = /Pairing code:\s*([0-9A-Z]{4}-[0-9A-Z]{4})/.exec(output)
        if (match?.[1]) {
          clearTimeout(timer)
          resolve(match[1])
        }
      })
      child.once("error", () => {
        clearTimeout(timer)
        resolve(undefined)
      })
      child.once("exit", () => {
        clearTimeout(timer)
        resolve(undefined)
      })
    })
    if (code === undefined) {
      this.state = "failed"
      this.lastError = "browse could not mint a pairing code; is the relay able to start?"
      return undefined
    }
    return { code, stop }
  }

  private async waitForConnection(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await extensionConnected()) return true
      if (this.child === undefined) return false
      await sleep(200)
    }
    return false
  }

  /** Kills a browser a previous run left behind, only when its command line is the executable we launch. */
  private async clearStale() {
    let record: BrowserRecord | undefined
    try {
      record = JSON.parse(readFileSync(statePath(), "utf8")) as BrowserRecord
    } catch {
      return
    }
    if (record?.pid && record.pid > 1 && (await isOurProcess(record.pid, record.executable))) {
      try {
        process.kill(record.pid, "SIGTERM")
      } catch {
        // Already gone.
      }
    }
    rmSync(statePath(), { force: true })
  }

  private stopChild() {
    const pair = this.pairChild
    if (pair !== undefined && pair.exitCode === null) pair.kill("SIGTERM")
    this.pairChild = undefined
    const child = this.child
    if (child === undefined) return
    this.child = undefined
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      }, 5_000).unref()
    }
    rmSync(statePath(), { force: true })
  }

  /** Disposes: the browser is stopped, the pairing file removed, the state file deleted. */
  async stop(): Promise<void> {
    this.disposed = true
    this.starting = undefined
    this.stopChild()
    await new Promise((resolve) => setTimeout(resolve, 150))
    if (existsSync(extensionDir())) clearPairingCode(extensionDir())
    // The browser is gone; the relay we started with it goes too, through browse's own shutdown.
    await this.stopOwnRelay()
    this.state = "stopped"
  }

}

/** The extension's own manifest version in the package copy, without preparing anything. */
export function packagedExtensionVersion(packageRoot: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(packageRoot, "managed-extension", "manifest.json"), "utf8")) as { version?: string }).version
  } catch {
    return undefined
  }
}
