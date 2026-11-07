import type { Plugin } from "@opencode/plugin"
import { DISPLAY_NAME, SERVER_NAME } from "./constants.js"

export interface IntegrationContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly integration: Pick<Plugin.Context["integration"], "transform" | "get" | "connection">
  readonly event: Pick<Plugin.Context["event"], "subscribe">
}

type Registration = Awaited<ReturnType<Plugin.Context["integration"]["transform"]>>

/** What `/connect` shows on the account while Ashby's server needs a new sign-in. */
const SIGN_IN_AGAIN = "Ashby needs a new sign-in. Choose this account to sign in again."

const STARTUP_POLL_MS = 250
const STARTUP_WINDOW_MS = 10_000
const RESUBSCRIBE_MS = 5_000

/**
 * Keeps the `/connect` entry of the `ashby` server named "Ashby", and marks its account "Sign in required" while the
 * server needs a new sign-in. The host registers the server's integration after plugin setup, and again under the
 * server name whenever the MCP config reloads, so the rename is registered once the integration exists, and again each
 * time the host's name comes back. Events trigger a check; the first seconds are also polled, because a subscription
 * has no start acknowledgement. `owned` is false while `ashby` is another server, which keeps its own name.
 */
export function watchIntegration(ctx: IntegrationContext, owned: () => boolean) {
  const stopped = new AbortController()
  let registration: Registration | undefined

  const sync = async () => {
    const server = owned() ? (await ctx.mcp.list()).data.find((item) => item.name === SERVER_NAME) : undefined
    const id = server?.integrationID
    if (!server || !id) return
    const { data } = await ctx.integration.get({ integrationID: id })
    if (data.name !== DISPLAY_NAME && !stopped.signal.aborted) {
      const previous = registration
      registration = await ctx.integration.transform((editor) => {
        if (editor.get(id)) editor.update(id, (integration) => void (integration.name = DISPLAY_NAME))
      })
      await previous?.dispose()
    }
    const connection = await ctx.integration.connection.active(id)
    if (connection?.type !== "credential") return
    // `active` returns the credential alone; the status the plugin sets is projected by `get`. Read it there, so the
    // mark it wrote is the one it clears, and another plugin's or the host's message is left alone.
    const shown = (await ctx.integration.get({ integrationID: id })).data.connections?.find((item) => item.type === "credential" && item.id === connection.id)
    const status = shown?.type === "credential" ? shown.status : undefined
    const reported = status?.message === SIGN_IN_AGAIN
    if (server.status.status === "needs_auth" && !status) {
      await ctx.integration.connection.status({ integrationID: id, connection, status: { status: "needs_auth", message: SIGN_IN_AGAIN } })
    } else if (server.status.status === "connected" && reported) {
      await ctx.integration.connection.status({ integrationID: id, connection, status: undefined })
    }
  }

  // One check at a time; triggers that arrive meanwhile cause one more check after it.
  let running: Promise<void> | undefined
  let again = false
  const schedule = () => {
    if (running) return void (again = true)
    running = (async () => {
      do {
        again = false
        if (!stopped.signal.aborted) await sync().catch(() => undefined)
      } while (again)
    })().finally(() => (running = undefined))
  }

  void (async () => {
    while (!stopped.signal.aborted) {
      try {
        const events = ctx.event.subscribe({ types: ["integration.updated", "mcp.status.changed", "credential.updated", "credential.switched"], signal: stopped.signal })
        for await (const event of events) if (event.type !== "mcp.status.changed" || event.data.server === SERVER_NAME) schedule()
      } catch {
        // The stream failed; check, then subscribe again.
      }
      if (!stopped.signal.aborted) schedule()
      await delay(RESUBSCRIBE_MS, stopped.signal)
    }
  })()
  const startup = (async () => {
    for (const until = Date.now() + STARTUP_WINDOW_MS; Date.now() < until && !stopped.signal.aborted; ) {
      schedule()
      await delay(STARTUP_POLL_MS, stopped.signal)
    }
  })()

  return async () => {
    stopped.abort()
    await startup
    await running
    await registration?.dispose()
    registration = undefined
  }
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
