// Relay hygiene for anything that runs the pinned browse binary: an isolated HOME and XDG dirs, a port that is never
// browse's default 19988, a shutdown through browse's own /shutdown, and an assertion that nothing is left.
//
// browse's relay daemonises: `browse pair`, `browse execute` and an MCP tool call start a `browse serve` whose parent
// becomes 1, so killing the MCP child does not stop it. A test that leaves one behind holds a port, and if that port
// is 19988 a user's real extension would try to connect to it.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

/** browse's default port. No test may use it. */
export const VENDOR_DEFAULT_PORT = 19988

/** Fails when the environment a test or script runs the binary in is not isolated. Call it before any spawn. */
export function assertIsolatedBrowseEnv() {
  const port = Number(process.env.OPENCODE_BROWSER_PORT)
  if (!Number.isInteger(port) || port <= 0) throw new Error("tests and scripts must set OPENCODE_BROWSER_PORT to a free port before running browse; it is unset")
  if (port === VENDOR_DEFAULT_PORT) throw new Error(`tests and scripts must never run browse on its default port ${VENDOR_DEFAULT_PORT}`)
  if (port > 65_535) throw new Error(`OPENCODE_BROWSER_PORT ${port} is not a port`)
  const home = process.env.HOME ?? ""
  const xdg = process.env.XDG_DATA_HOME ?? ""
  if (!/@|browse-(host|pack|managed|test)|opencode-browse-test/.test(home) || !(/tmp|private\/var\/folders/.test(home))) {
    throw new Error(`tests and scripts must run browse with an isolated HOME, not ${home}`)
  }
  if (!xdg.includes(home)) throw new Error(`XDG_DATA_HOME must live inside the isolated HOME, not ${xdg}`)
}

export const relayBase = (port = Number(process.env.OPENCODE_BROWSER_PORT)) => `http://127.0.0.1:${port}`

export const browseDataRoot = () =>
  process.env.OPENCODE_BROWSER_HOME ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "browse")

export const relayTokenPath = () => join(browseDataRoot(), "relay-token")

interface Version {
  readonly instanceId?: string
  readonly pid?: number
  readonly managed?: boolean
  readonly buildId?: string
  readonly shutdownProtocol?: number
}

async function version(port: number): Promise<Version | undefined> {
  try {
    const response = await fetch(`${relayBase(port)}/version`, { signal: AbortSignal.timeout(2_000) })
    return response.ok ? ((await response.json()) as Version) : undefined
  } catch {
    return undefined
  }
}

/** The command line and environment of a pid, for the fallback kill. */
function environmentOf(pid: number): string {
  try {
    if (process.platform === "linux") return readFileSync(`/proc/${pid}/environ`, "utf8")
    return execFileSync("ps", ["-E", "-p", String(pid), "-o", "command="], { encoding: "utf8" })
  } catch {
    return ""
  }
}

/** Pids of `browse serve` started with this test's HOME, from its command line and environment. */
export function relayPidsForHome(home = process.env.HOME ?? ""): number[] {
  let listing = ""
  try {
    listing = execFileSync("pgrep", ["-f", "opencode-browse-bin.*serve"], { encoding: "utf8" })
  } catch {
    return []
  }
  const marker = `HOME=${home}`
  return listing
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 1 && environmentOf(pid).includes(marker))
}

/**
 * Stops the relay this environment started: browse's own `/shutdown` with the relay token, and only when the relay
 * reports `managed: true` (a user's own relay is never stopped). Falls back to a SIGTERM of the pids whose environment
 * names this HOME.
 */
export async function stopRelay(port = Number(process.env.OPENCODE_BROWSER_PORT)): Promise<void> {
  const running = await version(port)
  if (running?.managed === true && running.instanceId) {
    try {
      const token = readFileSync(relayTokenPath(), "utf8").trim()
      await fetch(`${relayBase(port)}/shutdown`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          instanceId: running.instanceId,
          requestId: `test-${Date.now()}`,
          reason: "explicit-restart",
          force: true,
          client: { kind: "sdk", instanceId: `test-${process.pid}`, buildId: running.buildId ?? "0.0.0" },
        }),
      })
    } catch {
      // The fallback below handles a refusal.
    }
    for (let index = 0; index < 100; index++) {
      if ((await version(port)) === undefined) break
      await Bun.sleep(50)
    }
  }
  for (const pid of relayPidsForHome()) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Already gone.
    }
  }
  await Bun.sleep(200)
  for (const pid of relayPidsForHome()) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Already gone.
    }
  }
}

/** Fails the suite when a relay for this test's HOME outlives it. */
export function assertNoRelayLeft(home = process.env.HOME ?? "") {
  const pids = relayPidsForHome(home)
  if (pids.length > 0) throw new Error(`a browse serve with HOME=${home} outlived the test: ${pids.join(", ")}`)
}
