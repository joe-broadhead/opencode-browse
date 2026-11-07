// The relay managed mode starts: when pairing mints a code, browse starts its relay and daemonises it. Managed mode
// stops that relay on dispose, but only when it started it and the relay reports itself managed; a user's own relay is
// never stopped. Real mode leaves the relay running, which is browse's own behaviour.
import { readFileSync } from "node:fs"
import { relayPort, relayTokenPath } from "./paths.js"

interface Version {
  readonly instanceId?: string
  readonly pid?: number
  readonly managed?: boolean
  readonly buildId?: string
  readonly shutdownProtocol?: number
}

const base = () => `http://127.0.0.1:${relayPort()}`

/** The running relay's identity, or undefined when nothing answers on the port. */
export async function relayVersion(timeoutMs = 2_000): Promise<Version | undefined> {
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
