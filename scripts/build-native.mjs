// Builds the release files for the pinned browse binary (NATIVE-DESIGN.md, section 4), from manifest/browse.json.
//   node scripts/build-native.mjs --ensure                  this computer's pinned binary into .cache/bin, verified
//   node scripts/build-native.mjs --release <dir> --tag v0.0.0 --repository <owner/repo> --commit <sha> --run <id>
//       writes <dir>/browse-<platform>.gz for every platform the pin names (the gzip of the unmodified executable),
//       <dir>/LICENSE.browse, and <dir>/native-manifest.json: the candidate manifest/native.json the release commit pins.
// A binary comes from the URL the pin names. Its tarball and its binary are checked against the pin's sizes and SHA-256s
// before anything is written, so a wrong file never reaches a release. The pin is only read here: scripts/pin.mjs is the
// one that rewrites it. The release run is the native workflow on master (.github/workflows/native.yml), which runs on
// ubuntu and fetches the pinned tarballs; a local run uses .cache/bin when it already verifies.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gzipSync } from "node:zlib"

const root = fileURLToPath(new URL("..", import.meta.url))
const CACHE = join(root, ".cache", "bin")
const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const MODULE = "browse"
const REPOSITORY_NAME = pkg.name.replace(/^@[^/]+\//, "")

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const sha256File = (path) => sha256(readFileSync(path))

/** True when the file has the expected size and SHA-256. A missing file is not verified. */
export function verified(path, expected) {
  try {
    return statSync(path).size === expected.bytes && sha256File(path) === expected.sha256
  } catch {
    return false
  }
}

/**
 * Statuses that are worth another attempt. The release service has answered 416 (range not satisfiable) to a plain GET
 * from a CI runner, once, for one file that a second request served; a retry is the honest answer to that.
 */
const RETRY_STATUS = new Set([408, 416, 425, 429, 500, 502, 503, 504])

/** Downloads one URL to `dest` and keeps it only when it has the expected size and SHA-256. Transient failures retry. */
export async function download(url, dest, expected, { attempts = 3, retryDelayMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const failure = await attemptDownload(url, dest, expected)
    if (failure === undefined) return
    if (!failure.retry || attempt >= attempts) throw new Error(`${failure.message} (after ${attempt} attempt${attempt === 1 ? "" : "s"})`)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs * attempt))
  }
}

async function attemptDownload(url, dest, expected) {
  let response
  try {
    response = await fetch(url, { redirect: "follow", headers: { "user-agent": "opencode-browse-build/0.0.0" }, signal: AbortSignal.timeout(15 * 60_000) })
  } catch (error) {
    return { retry: true, message: `downloading ${url} failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel().catch(() => undefined)
    const served = ["server", "x-cache", "content-range"].map((name) => (response.headers.get(name) ? `${name} ${response.headers.get(name)}` : "")).filter(Boolean)
    return { retry: RETRY_STATUS.has(response.status), message: `downloading ${url} failed with HTTP ${response.status}${served.length ? ` (${served.join(", ")})` : ""}` }
  }
  const temp = `${dest}.${process.pid}.tmp`
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temp, { mode: 0o600 }))
  } catch (error) {
    rmSync(temp, { force: true })
    return { retry: true, message: `downloading ${url} was interrupted: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!verified(temp, expected)) {
    rmSync(temp, { force: true })
    return { retry: true, message: `${url} does not match the pinned size and SHA-256, so it was discarded` }
  }
  renameSync(temp, dest)
  return undefined
}

/** The pinned binary for one platform, in the cache: kept when it verifies, otherwise fetched, extracted and verified. */
export async function ensureBinary(platform) {
  const target = pin.targets[platform]
  if (target === undefined) throw new Error(`manifest/browse.json has no ${platform}`)
  const dir = join(CACHE, platform)
  const binary = join(dir, "browse")
  if (verified(binary, target)) return binary
  mkdirSync(dir, { recursive: true })
  const tarball = join(dir, "asset.tgz")
  await download(target.url, tarball, { bytes: target.tgzBytes, sha256: target.tgzSha256 })
  // The tarball holds package/bin/browse; extract only that member, so nothing else from it reaches the cache.
  execFileSync("tar", ["-xzf", tarball, "-C", dir, "package/bin/browse"], { stdio: "pipe" })
  renameSync(join(dir, "package", "bin", "browse"), binary)
  rmSync(join(dir, "package"), { recursive: true, force: true })
  rmSync(tarball, { force: true })
  chmodSync(binary, 0o755)
  if (!verified(binary, target)) {
    rmSync(binary, { force: true })
    throw new Error(`${platform}: the extracted binary does not match the pinned SHA-256 and size`)
  }
  return binary
}

/** The candidate manifest and the release files for every platform the pin names. Pure apart from the writes to `dir`. */
export async function buildRelease(dir, { tag, repository, commit, run }) {
  mkdirSync(dir, { recursive: true })
  const modules = { [MODULE]: {} }
  for (const [platform, target] of Object.entries(pin.targets)) {
    const binary = await ensureBinary(platform)
    const bytes = readFileSync(binary)
    const gz = gzipSync(bytes, { level: 9 })
    const name = `${MODULE}-${platform}.gz`
    writeFileSync(join(dir, name), gz)
    const base = `https://github.com/${repository}/releases/download/${tag}/`
    modules[MODULE][platform] = {
      name,
      url: `${base}${name}`,
      bytes: gz.length,
      sha256: sha256(gz),
      executable: { name: MODULE, bytes: bytes.length, sha256: sha256(bytes) },
    }
    if (bytes.length !== target.bytes || sha256(bytes) !== target.sha256) throw new Error(`${platform}: the binary does not match the pin`)
    console.log(`release: ${name} ${gz.length} bytes (executable ${bytes.length})`)
  }
  const licence = join(root, "vendor", "LICENSE.browse")
  copyFileSync(licence, join(dir, "LICENSE.browse"))
  const licenceBytes = readFileSync(licence)
  const manifest = {
    schema: 1,
    plugin: REPOSITORY_NAME,
    repository,
    tag,
    built: { commit, run: Number(run), workflow: "native" },
    modules,
    licences: [{ name: "LICENSE.browse", url: `https://github.com/${repository}/releases/download/${tag}/LICENSE.browse`, bytes: licenceBytes.length, sha256: sha256(licenceBytes) }],
  }
  writeFileSync(join(dir, "native-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`release: ${join(dir, "native-manifest.json")}`)
  return manifest
}

/** The platform key of this computer, or undefined when the pin names no browse build for it. */
export function currentPlatform(platform = process.platform, arch = process.arch) {
  const key = platform === "darwin" ? `darwin-${arch}` : platform === "linux" ? `linux-${arch}-gnu` : undefined
  return key !== undefined && key in pin.targets ? key : undefined
}

function parseFlags(argv) {
  const flags = { release: undefined, tag: undefined, repository: undefined, commit: undefined, run: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--release") flags.release = argv[++index]
    else if (arg === "--tag") flags.tag = argv[++index]
    else if (arg === "--repository") flags.repository = argv[++index]
    else if (arg === "--commit") flags.commit = argv[++index]
    else if (arg === "--run") flags.run = argv[++index]
    else throw new Error(`unknown argument ${arg}`)
  }
  return flags
}

async function main() {
  if (process.argv.includes("--ensure")) {
    // This computer's pinned binary, into .cache/bin, verified (CI and the tests run it before they use the binary).
    const key = currentPlatform()
    if (key === undefined) throw new Error(`no pinned browse build for ${process.platform}-${process.arch}`)
    console.log(`ensured ${await ensureBinary(key)}`)
    return
  }
  const flags = parseFlags(process.argv.slice(2))
  if (flags.release === undefined) throw new Error("usage: node scripts/build-native.mjs --release <dir> --tag <tag> --repository <owner/repo> --commit <sha> --run <id>")
  if (!flags.tag || !/^[\w.-]+\/[\w.-]+$/.test(flags.repository ?? "") || !/^[a-f0-9]{40}$/.test(flags.commit ?? "") || !/^\d+$/.test(flags.run ?? "")) {
    throw new Error("--release needs --tag, --repository (owner/name), --commit (the 40-hex commit built) and --run (the workflow run id)")
  }
  await buildRelease(resolve(flags.release), flags)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
