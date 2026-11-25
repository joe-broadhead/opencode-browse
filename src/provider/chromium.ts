// Chrome for Testing for managed mode: the pinned version, an on-demand download that verifies the size and SHA-256
// recorded in manifest/chromium.json, an extracted executable whose digest is recorded and re-checked on every start,
// and an explicit `chromiumPath` for a Chromium the user already has.
//
// Chrome for Testing is Google's official unbranded Chrome build. Branded Chrome refuses a preloaded unpacked
// extension, which is why managed mode uses CfT.
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { browseError } from "../constants.js"
import { cacheRoot } from "./paths.js"

/** The platform keys the pin uses, and the CfT platform each is. */
export type ManagedPlatform = "darwin-arm64" | "darwin-x64" | "linux-x64-gnu" | "linux-arm64-gnu"

export function managedPlatform(platform: string = process.platform, arch: string = process.arch): ManagedPlatform | undefined {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64"
  if (platform === "darwin" && arch === "x64") return "darwin-x64"
  if (platform === "linux" && arch === "x64") return "linux-x64-gnu"
  if (platform === "linux" && arch === "arm64") return "linux-arm64-gnu"
  return undefined
}

interface ChromiumPin {
  readonly version: string
  readonly source: string
  readonly platforms: Record<string, { readonly cftPlatform: string; readonly url: string; readonly sha256: string; readonly bytes: number }>
}

interface InstallRecord {
  readonly version: string
  readonly executable: string
  readonly sha256: string
  readonly bytes: number
  readonly installedAt: string
}

export interface ChromiumInfo {
  readonly path: string
  readonly version: string
  readonly source: "installed" | "option"
  readonly verified: boolean
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** The bundled pin: manifest/chromium.json beside the package's dist/. */
export function readPin(manifestDir: string): ChromiumPin {
  return JSON.parse(readFileSync(join(manifestDir, "chromium.json"), "utf8")) as ChromiumPin
}

export const installRoot = (version: string) => join(cacheRoot(), "chromium", version)

/** The executable inside an extracted CfT tree. */
export function executableIn(root: string, cftPlatform: string): string {
  if (cftPlatform.startsWith("mac-")) return join(root, `chrome-${cftPlatform}`, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")
  return join(root, `chrome-${cftPlatform}`, "chrome")
}

function recordPath(version: string) {
  return join(installRoot(version), "install.json")
}

/** The installed CfT for this platform, verified against the digest recorded when it was extracted. */
export function installedChromium(pin: ChromiumPin, platform: ManagedPlatform = managedPlatform()!): ChromiumInfo | undefined {
  const asset = pin.platforms[platform]
  if (asset === undefined) return undefined
  let record: InstallRecord
  try {
    record = JSON.parse(readFileSync(recordPath(pin.version), "utf8")) as InstallRecord
  } catch {
    return undefined
  }
  if (!existsSync(record.executable)) return undefined
  if (sha256(record.executable) !== record.sha256) {
    throw browseError("CHROMIUM_UNVERIFIED", "Chrome for Testing does not match the digest recorded when it was installed, so it was not run.", "Run /browse-install-browser to install a fresh copy, or set \"chromiumPath\".")
  }
  return { path: record.executable, version: record.version, source: "installed", verified: true }
}

function download(url: string, file: string, expected: { sha256: string; bytes: number }): Promise<void> {
  return (async () => {
    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
    mkdirSync(dirname(file), { recursive: true })
    const hash = createHash("sha256")
    let bytes = 0
    await pipeline(
      Readable.fromWeb(response.body as never),
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          hash.update(chunk)
          bytes += chunk.length
          yield chunk
        }
      },
      createWriteStream(file),
    )
    if (bytes !== expected.bytes) throw new Error(`expected ${expected.bytes} bytes, got ${bytes}`)
    if (hash.digest("hex") !== expected.sha256) throw new Error("the download does not match the pinned SHA-256")
  })()
}

/**
 * Downloads and extracts the pinned CfT for this platform. On-demand only: `/browse-install-browser` calls it, and
 * nothing else does. The download is verified against manifest/chromium.json, and the extracted executable's digest
 * is recorded so a later tamper is refused.
 */
export async function installChromium(manifestDir: string, platform: ManagedPlatform = managedPlatform()!): Promise<ChromiumInfo> {
  const pin = readPin(manifestDir)
  const asset = pin.platforms[platform]
  if (asset === undefined) {
    throw browseError("CHROMIUM_UNSUPPORTED", `There is no Chrome for Testing build for ${platform}.`, "Set \"chromiumPath\" to a Chromium or Chrome for Testing binary you already have, or use browse's real-browser mode.")
  }
  const root = installRoot(pin.version)
  const zip = join(root, "chrome.zip")
  mkdirSync(root, { recursive: true })
  try {
    await download(asset.url, zip, asset)
  } catch (error) {
    rmSync(zip, { force: true })
    throw browseError("CHROMIUM_DOWNLOAD_FAILED", `Chrome for Testing ${pin.version} could not be downloaded (${error instanceof Error ? error.message : String(error)}).`, "Check the network, then run /browse-install-browser again.")
  }
  // Extract over the same folder; a partial tree is replaced by the verified one.
  mkdirSync(root, { recursive: true })
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("unzip", ["-q", "-o", zip, "-d", root], (error) => (error ? reject(error) : resolve()))
    })
  } catch (error) {
    throw browseError("CHROMIUM_EXTRACT_FAILED", `The Chrome for Testing archive could not be extracted (${error instanceof Error ? error.message : String(error)}).`, "Install unzip, then run /browse-install-browser again.")
  } finally {
    rmSync(zip, { force: true })
  }
  const executable = executableIn(root, asset.cftPlatform)
  if (!existsSync(executable)) {
    throw browseError("CHROMIUM_EXTRACT_FAILED", "The Chrome for Testing archive did not contain the expected executable.", "Run /browse-install-browser again.")
  }
  chmodSync(executable, 0o755)
  const data = readFileSync(executable)
  const record: InstallRecord = { version: pin.version, executable, sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length, installedAt: new Date().toISOString() }
  writeFileSync(recordPath(pin.version), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  return { path: executable, version: pin.version, source: "installed", verified: true }
}

/** `Google Chrome for Testing 157.0.8103.38`, `Chromium 141.0.7390.54`, ... */
export function parseChromiumVersion(output: string): { version: string; branded: boolean } | undefined {
  const text = output.trim()
  const match = /(\d+\.\d+\.\d+\.\d+)/.exec(text)
  if (match === null) return undefined
  // Branded Chrome (without "for Testing") refuses a preloaded unpacked extension.
  const branded = /\bGoogle Chrome\b/i.test(text) && !/for Testing/i.test(text)
  return { version: match[1]!, branded }
}

/** Runs `<path> --version` and records what it is. Branded Chrome is refused for managed mode. */
export function probeChromium(path: string): Promise<ChromiumInfo> {
  return new Promise((resolve, reject) => {
    if (!existsSync(path)) return reject(browseError("CHROMIUM_MISSING", `The chromiumPath option points at ${path}, which does not exist.`, "Fix the path, or remove it and run /browse-install-browser."))
    execFile(path, ["--version"], { timeout: 15_000, maxBuffer: 1 << 20 }, (error, stdout) => {
      const parsed = parseChromiumVersion(String(stdout ?? ""))
      if (error || parsed === undefined) {
        return reject(browseError("CHROMIUM_INVALID", `The file at ${path} did not answer --version like a Chromium browser.`, "Point chromiumPath at Chromium or Chrome for Testing, not another program."))
      }
      if (parsed.branded) {
        return reject(browseError("CHROMIUM_BRANDED", "That is branded Google Chrome, which refuses a preloaded unpacked extension, so managed mode cannot use it.", "Remove chromiumPath to use the pinned Chrome for Testing, or point it at Chromium."))
      }
      resolve({ path, version: parsed.version, source: "option", verified: false })
    })
  })
}

/** The Chromium managed mode will run: `chromiumPath` when set, else the installed pinned CfT. */
export async function resolveChromium(manifestDir: string, options: { chromiumPath?: string; platform?: ManagedPlatform }): Promise<ChromiumInfo | undefined> {
  const platform = options.platform ?? managedPlatform()
  if (options.chromiumPath !== undefined) return probeChromium(options.chromiumPath)
  if (platform === undefined) return undefined
  return installedChromium(readPin(manifestDir), platform)
}

/** The pin, for status: version and whether this platform has a build. */
export function pinSummary(manifestDir: string, platform: ManagedPlatform | undefined = managedPlatform()) {
  try {
    const pin = readPin(manifestDir)
    return { version: pin.version, supported: platform !== undefined && pin.platforms[platform] !== undefined, bytes: platform ? pin.platforms[platform]?.bytes : undefined }
  } catch {
    return undefined
  }
}

export const executableName = (path: string) => basename(path)
export const fileSize = (path: string) => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
