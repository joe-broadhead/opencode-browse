// Managed mode, for real: the packaged browse binary, a real Chrome for Testing downloaded and verified into this
// run's isolated cache, its own profile, an automatic pairing through browse's own protocol, a local test page, a
// screenshot, and a clean stop. Nothing here touches the owner's browser, Chrome or profile: HOME, XDG_* and TMPDIR
// are a fresh temp root.
import { afterAll, expect, test } from "bun:test"
import { createServer as createHttpServer } from "node:http"
import { createServer as createTcpServer } from "node:net"
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { ROOT } from "../host/isolate.js"
import { installChromium, installRoot, managedPlatform, readPin } from "../../src/managed/chromium.js"
import { ManagedBrowser } from "../../src/managed/browser.js"
import { platformKey, runBinary, resolveBinary } from "../../src/engine.js"
import { pinnedBinary } from "../support/pinned.js"
import { cleanup, startHost, until } from "../host/harness.js"
import { assertNoRelayLeft, relayPidsForHome, stopRelay } from "../support/relays.js"
import { relayVersion } from "../../src/managed/relay.js"

// The one host this test may reach: Google's Chrome for Testing downloads. The harness blocks every other egress.
process.env.HOST_TEST_EGRESS = "storage.googleapis.com"

afterAll(cleanup)

const root = new URL("../..", import.meta.url).pathname
const projectRoot = root.endsWith("/") ? root.slice(0, -1) : root

/** A free loopback port, so this run's relay is its own. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createTcpServer()
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

test(
  "starts a separate Chromium, pairs it, drives a page and takes a screenshot, then stops",
  async () => {
    const platform = managedPlatform()
    if (platform === undefined) return
    // A free port: the owner's own relay may hold 19988, and this run must not talk to it.
    process.env.OPENCODE_BROWSER_PORT = String(await freePort())
    // The same installer /browse-install-browser runs, into this run's isolated cache, verified against the pin. A
    // persistent copy of an earlier verified download saves the 200 MB on a repeat run; the first run downloads it.
    const pin = readPin(join(projectRoot, "manifest"))
    const persistent = join(projectRoot, ".cache", "cft", pin.version)
    if (existsSync(persistent)) {
      mkdirSync(installRoot(pin.version), { recursive: true })
      cpSync(persistent, installRoot(pin.version), { recursive: true })
    }
    const chromium = await installChromium(join(projectRoot, "manifest"), platform)
    expect(chromium.verified).toBe(true)
    expect(existsSync(chromium.path)).toBe(true)
    if (!existsSync(persistent)) {
      mkdirSync(persistent, { recursive: true })
      cpSync(installRoot(pin.version), persistent, { recursive: true })
    }

    // The pinned binary (npm run bin:ensure): the bytes the release ships, checked here against the pin.
    const pinnedPath = pinnedBinary()
    if (pinnedPath === undefined) throw new Error("the pinned browse binary is not in .cache/bin: run npm run bin:ensure")
    const binary = await resolveBinary({ optionPath: pinnedPath })
    expect(binary.source).toBe("option")
    const browsePin = JSON.parse(readFileSync(join(projectRoot, "manifest", "browse.json"), "utf8"))
    expect(createHash("sha256").update(readFileSync(binary.path)).digest("hex")).toBe(browsePin.targets[platformKey()!].sha256)

    // A local page the managed browser will open. Nothing leaves the machine.
    const page = createHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Managed Browse Test</title><h1 id=ok>managed works</h1>")
    })
    await new Promise<void>((resolve) => page.listen(0, "127.0.0.1", resolve))
    const url = `http://127.0.0.1:${(page.address() as AddressInfo).port}/`

    const browser = new ManagedBrowser({ packageRoot: projectRoot, binary: binary.path, headless: true })
    try {
      await browser.start()
      const status = browser.status()
      console.log("managed test: status", JSON.stringify({ state: status.state, lastError: status.lastError, chromium: status.chromium, extension: status.extension, pid: status.pid }))
      try {
        console.log("managed test: browser log", readFileSync(join(status.profile, "..", "browser.log"), "utf8").slice(-1000))
      } catch {}
      try {
        console.log("managed test: relay log", readFileSync(join(process.env.XDG_STATE_HOME!, "browse", "logs", "relay.log"), "utf8").slice(-2000))
      } catch {}
      expect(status.state).toBe("running")
      expect(status.chromium.verified).toBe(true)
      expect(status.extension.version).toBe("0.0.15")
      expect(status.pid).toBeGreaterThan(1)
      expect(status.profile).toBe(join(process.env.XDG_DATA_HOME!, "opencode-browse", "managed", "profile"))

      // Drive the managed browser through the pinned CLI, which uses the relay the pairing started.
      const title = await runBinary(binary.path, ["execute", `await page.goto(${JSON.stringify(url)}); return await page.title()`], { timeoutMs: 90_000 })
      expect(title.stdout).toContain("Managed Browse Test")

      const shot = join(ROOT, "managed-shot.png")
      const captured = await runBinary(binary.path, ["execute", `await page.screenshot({ path: ${JSON.stringify(shot)} }); return "shot"`], { timeoutMs: 90_000 })
      expect(captured.stdout).toContain("shot")
      expect(existsSync(shot)).toBe(true)
      expect(readFileSync(shot).subarray(1, 4).toString("latin1")).toBe("PNG")

      // The state file names the browser this plugin launched, in its own profile.
      const state = JSON.parse(readFileSync(join(process.env.XDG_DATA_HOME!, "opencode-browse", "managed", "browser.json"), "utf8")) as { pid: number; executable: string }
      expect(state.executable).toContain("Chrome for Testing")
      expect(state.pid).toBe(status.pid as number)

      await browser.stop()
      expect(browser.status().state).toBe("stopped")
      // No zombie: the process is gone, and the profile's lock with it.
      let alive = true
      for (let index = 0; index < 50 && alive; index++) {
        try {
          process.kill(state.pid, 0)
          await Bun.sleep(100)
        } catch {
          alive = false
        }
      }
      expect(alive).toBe(false)
      expect(existsSync(join(process.env.XDG_DATA_HOME!, "opencode-browse", "managed", "browser.json"))).toBe(false)
      expect(existsSync(join(status.profile, "SingletonLock"))).toBe(false)
      // The relay the pairing started is stopped with the browser: browse's own shutdown, then nothing left at all.
      expect(await relayVersion()).toBeUndefined()
      expect(relayPidsForHome()).toEqual([])
      assertNoRelayLeft()
    } finally {
      await browser.stop().catch(() => undefined)
      await new Promise((resolve) => page.close(resolve))
    }
  },
  900_000,
)

test(
  "the plugin's dispose stops the managed browser and its relay",
  async () => {
    const host = await startHost({ packagedBinary: true, options: { browser: "managed", headless: true } })
    try {
      await until("the managed relay is up", async () => {
        const response = await fetch(`http://127.0.0.1:${process.env.OPENCODE_BROWSER_PORT}/version`).catch(() => undefined)
        return response?.ok === true
      }, 120_000)
      expect(relayPidsForHome().length).toBe(1)
    } finally {
      await host.close()
    }
    // The host closed: no browser, no relay, nothing for this HOME.
    expect(await relayVersion()).toBeUndefined()
    expect(relayPidsForHome()).toEqual([])
    assertNoRelayLeft()
    await stopRelay(Number(process.env.OPENCODE_BROWSER_PORT))
  },
  900_000,
)
