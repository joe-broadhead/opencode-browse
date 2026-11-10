// Builds the platform packages that carry the pinned browse binary, from manifest/browse.json.
//   node scripts/build-bins.mjs                 every platform: fetch what .cache/bin lacks, verify it, write dist-packages/
//   node scripts/build-bins.mjs --current       this computer's platform only (what CI and a local check need)
//   node scripts/build-bins.mjs --local         also install this computer's package into node_modules, for the tests
//   node scripts/build-bins.mjs --pack          also write each package's .tgz beside it
// A binary comes from the URL the pin names. Its tarball and its binary are checked against the pin's sizes and
// SHA-256s before anything is packaged, so a wrong file never reaches a package. The pin is only read here:
// scripts/pin.mjs is the one that rewrites it.
// Each package ships bin/browse, manifest/browse.json (the binary's SHA-256 and size), LICENSE.browse and NOTICE.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const OUT = join(root, "dist-packages")
const CACHE = join(root, ".cache", "bin")
const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version

/** The npm fields for each platform key the pin names. Linux packages name their glibc floor. */
export const PLATFORMS = {
  "darwin-arm64": { os: ["darwin"], cpu: ["arm64"] },
  "darwin-x64": { os: ["darwin"], cpu: ["x64"] },
  "linux-x64-gnu": { os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
  "linux-arm64-gnu": { os: ["linux"], cpu: ["arm64"], libc: ["glibc"] },
}

export const packageName = (platform) => `@joe-broadhead/opencode-browse-bin-${platform}`

/** The platform key of this computer, or undefined when the pin names no browse build for it. */
export function currentPlatform(platform = process.platform, arch = process.arch) {
  const key = platform === "darwin" ? `darwin-${arch}` : platform === "linux" ? `linux-${arch}-gnu` : undefined
  return key !== undefined && key in PLATFORMS ? key : undefined
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** True when the file has the expected size and SHA-256. A missing file is not verified. */
export function verified(path, expected) {
  try {
    return statSync(path).size === expected.bytes && sha256(path) === expected.sha256
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
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt))
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

export function build(platform, fields, binary) {
  const target = pin.targets[platform]
  const dir = join(OUT, `opencode-browse-bin-${platform}`)
  mkdirSync(join(dir, "bin"), { recursive: true })
  mkdirSync(join(dir, "manifest"), { recursive: true })
  copyFileSync(binary, join(dir, "bin", "browse"))
  chmodSync(join(dir, "bin", "browse"), 0o755)
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: packageName(platform),
        version,
        description: `The pinned browse ${pin.version} binary for ${platform}, for @joe-broadhead/opencode-browse`,
        license: "MIT",
        repository: { type: "git", url: "git+https://github.com/joe-broadhead/opencode-browse.git" },
        os: fields.os,
        cpu: fields.cpu,
        ...(fields.libc ? { libc: fields.libc } : {}),
        files: ["bin", "manifest", "LICENSE.browse", "NOTICE"],
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(dir, "manifest", "browse.json"),
    `${JSON.stringify(
      {
        version: pin.version,
        target: target.target,
        sha256: target.sha256,
        bytes: target.bytes,
        upstream: pin.upstream,
        licence: pin.licence,
      },
      null,
      2,
    )}\n`,
  )
  copyFileSync(join(root, "vendor", "LICENSE.browse"), join(dir, "LICENSE.browse"))
  copyFileSync(join(root, "NOTICE"), join(dir, "NOTICE"))
  return dir
}

async function main() {
  const args = process.argv.slice(2)
  const current = args.includes("--current")
  const only = current ? currentPlatform() : undefined
  if (current && only === undefined) {
    console.log(`build-bins: the pin names no browse build for ${process.platform}-${process.arch}; nothing built.`)
    return
  }
  const platforms = Object.keys(PLATFORMS).filter((key) => only === undefined || key === only)
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const built = {}
  for (const platform of platforms) {
    const binary = await ensureBinary(platform)
    built[platform] = build(platform, PLATFORMS[platform], binary)
    console.log(`built ${packageName(platform)}@${version} in ${built[platform].slice(root.length)}`)
  }

  if (args.includes("--pack")) {
    for (const dir of Object.values(built)) execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", OUT], { cwd: dir, stdio: "pipe" })
    console.log("packed each platform package")
  }

  if (args.includes("--local")) {
    const key = currentPlatform()
    if (key === undefined || built[key] === undefined) throw new Error("--local needs this computer's platform, which the pin names")
    const target = join(root, "node_modules", "@joe-broadhead", `opencode-browse-bin-${key}`)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(join(root, "node_modules", "@joe-broadhead"), { recursive: true })
    execFileSync("cp", ["-R", built[key], target])
    console.log(`installed ${packageName(key)} into node_modules`)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`build-bins: ${error.message}`)
    process.exit(1)
  })
}
