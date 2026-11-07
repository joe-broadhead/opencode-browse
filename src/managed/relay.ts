// The relay managed mode starts: when pairing mints a code, browse starts its relay and daemonises it. Managed mode
// stops that relay on dispose, but only when it started it and the relay reports itself managed; a user's own relay is
// never stopped. Real mode leaves the relay running, which is browse's own behaviour.
import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { relayPort, relayTokenPath } from "./paths.js"

export interface RelayVersion {
  readonly version?: string
  readonly instanceId?: string
  readonly pid?: number
  readonly managed?: boolean
  readonly buildId?: string
  readonly shutdownProtocol?: number
}

type Version = RelayVersion

const base = () => `http://127.0.0.1:${relayPort()}`

/** The running relay's identity, or undefined when nothing answers on the port. */
export async function relayVersion(timeoutMs = 2_000): Promise<RelayVersion | undefined> {
  try {
    const response = await fetch(`${base()}/version`, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok ? ((await response.json()) as Version) : undefined
  } catch {
    return undefined
  }
}

/**
 * Stops a managed relay through browse's own `/shutdown`, the route its uninstall uses: the instance id from
 * `/version`, a request id, and the relay token. Waits until the port no longer answers. Never throws; returns whether
 * the relay is gone.
 */
/** The command line a pid runs, or undefined when it cannot be read (a pid we do not own, or no `ps`). */
export function processCommand(pid: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "command="], { timeout: 2_000 }, (error, stdout) => {
      resolve(error ? undefined : String(stdout).trim() || undefined)
    })
  })
}

export type RelayOwnership =
  | { readonly ours: true }
  | { readonly ours: false; readonly reason: string }

/**
 * Whether the relay answering on the port is the one this installation runs: browse's own managed relay, at the pinned
 * version, whose pid's command line names our binary. A relay from another browse build, another install, or with
 * `managed` unset is refused rather than stopped.
 */
export function relayOwnership(version: RelayVersion | undefined, command: string | undefined, expectedVersion: string, binaryPath?: string): RelayOwnership {
  if (version === undefined) return { ours: false, reason: "nothing is running on the relay port" }
  if (version.managed !== true) return { ours: false, reason: "the relay on the port was not started by this plugin's browse" }
  if (typeof version.version === "string" && version.version !== expectedVersion) {
    return { ours: false, reason: `the relay runs browse ${version.version}, not the pinned ${expectedVersion}` }
  }
  if (binaryPath !== undefined && command !== undefined && !command.includes(binaryPath)) {
    return { ours: false, reason: `the relay at pid ${version.pid ?? "unknown"} is not the pinned binary` }
  }
  return { ours: true }
}

export type RelayStop =
  | { readonly state: "stopped" }
  | { readonly state: "not_running" }
  | { readonly state: "refused"; readonly reason: string }
  | { readonly state: "failed" }

/**
 * Stops the relay this installation runs, through browse's own `/shutdown` with the relay token. Never kills by name,
 * never stops another browse's relay, and never reports the token. Returns what happened; the caller words the message.
 */
export async function stopRelaySafely(options: { readonly expectedVersion: string; readonly binaryPath?: string }): Promise<RelayStop> {
  const running = await relayVersion()
  if (running === undefined) return { state: "not_running" }
  const command = running.pid === undefined ? undefined : await processCommand(running.pid)
  const ownership = relayOwnership(running, command, options.expectedVersion, options.binaryPath)
  if (!ownership.ours) return { state: "refused", reason: ownership.reason }
  if (running.instanceId === undefined) return { state: "failed" }
  return (await stopManagedRelay(running.instanceId, running.buildId ?? "")) ? { state: "stopped" } : { state: "failed" }
}

/** The text `/browse-stop-relay` prints. Never contains the relay token. */
export function formatRelayStop(result: RelayStop, port = relayPort()): string {
  if (result.state === "stopped") return `The browse relay on 127.0.0.1:${port} is stopped. The next tool call starts a new one when it needs the browser.`
  if (result.state === "not_running") return `No browse relay is running on 127.0.0.1:${port}.`
  if (result.state === "refused") return `RELAY_NOT_OURS: ${result.reason}. Next step: Stop it yourself only if you know what it is, or use the browse install that started it.`
  return `RELAY_STOP_FAILED: The relay accepted the request but did not stop. Next step: Run /browse-doctor and follow its next step.`
}

export async function stopManagedRelay(instanceId: string, buildId: string): Promise<boolean> {
  try {
    const token = readFileSync(relayTokenPath(), "utf8").trim()
    await fetch(`${base()}/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        instanceId,
        requestId: `managed-${Date.now()}`,
        reason: "explicit-restart",
        force: true,
        client: { kind: "sdk", instanceId: `managed-${process.pid}`, buildId: buildId || "0.0.0" },
      }),
    })
  } catch {
    return (await relayVersion()) === undefined
  }
  for (let index = 0; index < 100; index++) {
    if ((await relayVersion(500)) === undefined) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}
