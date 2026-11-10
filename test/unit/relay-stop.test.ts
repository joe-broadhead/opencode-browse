// `/browse-stop-relay`: it stops only the relay this installation's binary started, through browse's own shutdown,
// and says why when the relay on the port is someone else's. No token appears in any message.
import { describe, expect, test } from "bun:test"
import { formatRelayStop, relayOwnership, type RelayVersion, type RelayStop } from "../../src/managed/relay.js"
import { registerStopRelayCommand } from "../../src/plugin.js"

const version: RelayVersion = { version: "0.0.14", instanceId: "inst-1", pid: 42, managed: true, buildId: "build-1", shutdownProtocol: 2 }
const binary = "/cache/native/v0.0.0/browse/darwin-arm64/browse"
const command = `/${binary.replace(/^\//, "")} serve`

describe("relayOwnership", () => {
  test("accepts the managed relay at the pinned version whose pid runs our binary", () => {
    expect(relayOwnership(version, command, "0.0.14", binary)).toEqual({ ours: true })
  })

  test("refuses a relay this plugin did not start", () => {
    expect(relayOwnership({ ...version, managed: false }, command, "0.0.14", binary)).toMatchObject({ ours: false, reason: expect.stringContaining("not started by this plugin") })
  })

  test("refuses another browse version", () => {
    expect(relayOwnership({ ...version, version: "0.0.13" }, command, "0.0.14", binary)).toMatchObject({ ours: false, reason: expect.stringContaining("not the pinned 0.0.14") })
  })

  test("refuses a relay whose pid runs another binary", () => {
    expect(relayOwnership(version, "/usr/local/bin/browse serve", "0.0.14", binary)).toMatchObject({ ours: false, reason: expect.stringContaining("not the pinned binary") })
  })

  test("nothing on the port is not a refusal", () => {
    expect(relayOwnership(undefined, undefined, "0.0.14", binary)).toEqual({ ours: false, reason: "nothing is running on the relay port" })
  })
})

describe("formatRelayStop", () => {
  test("names the port and one next step, and never a token", () => {
    expect(formatRelayStop({ state: "stopped" }, 23456)).toBe("The browse relay on 127.0.0.1:23456 is stopped. The next tool call starts a new one when it needs the browser.")
    expect(formatRelayStop({ state: "not_running" }, 23456)).toBe("No browse relay is running on 127.0.0.1:23456.")
    const refused = formatRelayStop({ state: "refused", reason: "the relay runs browse 0.0.13, not the pinned 0.0.14" }, 23456)
    expect(refused).toStartWith("RELAY_NOT_OURS: the relay runs browse 0.0.13, not the pinned 0.0.14.")
    expect(refused.match(/Next step:/g)).toHaveLength(1)
    const failed = formatRelayStop({ state: "failed" }, 23456)
    expect(failed).toStartWith("RELAY_STOP_FAILED:")
    for (const text of [refused, failed, formatRelayStop({ state: "stopped" })]) expect(text.toLowerCase()).not.toContain("token")
  })
})

describe("the /browse-stop-relay command", () => {
  async function run(stop: () => Promise<RelayStop>, hasBinary = true) {
    type Command = { name: string; execute: (input: { sessionID: string }) => Promise<void> }
    let registered: Command | undefined
    let text: string | undefined
    const editor = { add: (command: Command) => void (registered = command) }
    const ctx = {
      command: {
        transform: (callback: (value: { add: (command: Command) => void }) => void) => {
          callback(editor)
          return Promise.resolve({ dispose: async () => undefined })
        },
      },
      session: { synthetic: async ({ text: value }: { text: string }) => void (text = value) },
    }
    const dispose = await registerStopRelayCommand(ctx as never, { binary: () => (hasBinary ? ({ path: binary } as never) : undefined), stop })
    expect(dispose).toBeDefined()
    expect(registered?.name).toBe("browse-stop-relay")
    await registered!.execute({ sessionID: "ses_1" })
    return text
  }

  test("stops the relay and prints the stop text", async () => {
    expect(await run(async () => ({ state: "stopped" }))).toBe(formatRelayStop({ state: "stopped" }))
  })

  test("prints the refusal it was given", async () => {
    const refused: RelayStop = { state: "refused", reason: "the relay on the port was not started by this plugin's browse" }
    expect(await run(async () => refused)).toBe(formatRelayStop(refused))
  })

  test("with no binary, it says what to do instead", async () => {
    const text = await run(async () => ({ state: "stopped" }), false)
    expect(text).toStartWith("NOT_INSTALLED:")
    expect(text).toContain("Next step: Reinstall the plugin.")
  })
})
