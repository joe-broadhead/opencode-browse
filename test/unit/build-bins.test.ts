// The platform packages' build rules: the mapping from this computer to a pinned build, the digest check that refuses a
// wrong binary, the table of platforms agreeing with the pin, and the download's retry of transient answers.
import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { currentPlatform, download, PLATFORMS, verified } from "../../scripts/build-bins.mjs"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-build-bins-")))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const BODY = Buffer.from("pinned browse bytes")
const EXPECTED = { bytes: BODY.length, sha256: createHash("sha256").update(BODY).digest("hex") }

/** A local server that answers each request with the next response in `script`, and counts the requests. */
async function serve(script: { status: number; body?: Buffer }[]): Promise<{ url: string; requests: () => number; close: () => Promise<void> }> {
  let count = 0
  const server: Server = createServer((_request, response) => {
    const step = script[Math.min(count, script.length - 1)]!
    count += 1
    response.writeHead(step.status, { "content-length": String(step.body?.length ?? 0), server: "test-release" })
    response.end(step.body ?? "")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}/browse.tgz`,
    requests: () => count,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe("build-bins", () => {
  test("maps this computer to the pinned platform key, and refuses a platform the pin does not name", () => {
    expect(currentPlatform("darwin", "arm64")).toBe("darwin-arm64")
    expect(currentPlatform("darwin", "x64")).toBe("darwin-x64")
    expect(currentPlatform("linux", "x64")).toBe("linux-x64-gnu")
    expect(currentPlatform("linux", "arm64")).toBe("linux-arm64-gnu")
    expect(currentPlatform("win32", "x64")).toBeUndefined()
  })

  test("every pinned target has a platform package, and no platform is packaged without a pin", () => {
    expect(Object.keys(pin.targets).sort()).toEqual(Object.keys(PLATFORMS).sort())
  })

  test("a file is verified only at the pinned size and SHA-256", () => {
    const path = join(work, "browse")
    writeFileSync(path, BODY)
    expect(verified(path, EXPECTED)).toBe(true)
    expect(verified(path, { ...EXPECTED, bytes: BODY.length + 1 })).toBe(false)
    expect(verified(path, { ...EXPECTED, sha256: "0".repeat(64) })).toBe(false)
    expect(verified(join(work, "missing"), EXPECTED)).toBe(false)
  })

  test("a transient 416 is retried, and the verified body is kept", async () => {
    const server = await serve([{ status: 416 }, { status: 200, body: BODY }])
    const dest = join(work, "retried")
    try {
      await download(server.url, dest, EXPECTED, { retryDelayMs: 1 })
      expect(server.requests()).toBe(2)
      expect(readFileSync(dest)).toEqual(BODY)
    } finally {
      await server.close()
    }
  })

  test("a 404 is not retried, and says what the service answered", async () => {
    const server = await serve([{ status: 404 }])
    const dest = join(work, "missing-file")
    try {
      const error = await download(server.url, dest, EXPECTED, { retryDelayMs: 1 }).then(() => undefined, (cause: unknown) => cause as Error)
      expect(error?.message).toContain("HTTP 404")
      expect(error?.message).toContain("server test-release")
      expect(server.requests()).toBe(1)
      expect(existsSync(dest)).toBe(false)
    } finally {
      await server.close()
    }
  })

  test("a body that does not match the pin is refused after its attempts, and leaves no file", async () => {
    const server = await serve([{ status: 200, body: Buffer.from("tampered bytes") }])
    const dest = join(work, "tampered")
    try {
      const error = await download(server.url, dest, EXPECTED, { attempts: 2, retryDelayMs: 1 }).then(() => undefined, (cause: unknown) => cause as Error)
      expect(error?.message).toContain("does not match the pinned size and SHA-256")
      expect(error?.message).toContain("after 2 attempts")
      expect(server.requests()).toBe(2)
      expect(existsSync(dest)).toBe(false)
    } finally {
      await server.close()
    }
  })
})
