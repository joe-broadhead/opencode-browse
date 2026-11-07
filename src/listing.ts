import type { Plugin } from "@opencode/plugin"
import { SERVER_NAME } from "./constants.js"

const RESUBSCRIBE_MS = 5_000

/**
 * Notes when the `ashby` server's status last changed, so status can tell a server that is still listing its tools from
 * one that lists none for this account: the host lists a server's tools shortly after it connects. Returns the time,
 * in milliseconds since the epoch, and a cleanup. Makes no Ashby call.
 */
export function watchListing(ctx: { readonly event: Pick<Plugin.Context["event"], "subscribe"> }) {
  let changedAt = Date.now()
  const stopped = new AbortController()
  const watching = (async () => {
    while (!stopped.signal.aborted) {
      try {
        const events = ctx.event.subscribe({ types: ["mcp.status.changed"], signal: stopped.signal })
        for await (const event of events) if (event.data.server === SERVER_NAME) changedAt = Date.now()
      } catch {
        // The stream failed; subscribe again.
      }
      await delay(RESUBSCRIBE_MS, stopped.signal)
    }
  })()
  return {
    changedAt: () => changedAt,
    stop: async () => {
      stopped.abort()
      await watching
    },
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
