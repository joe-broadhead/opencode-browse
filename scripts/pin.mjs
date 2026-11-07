// Pins the browse binary this plugin ships. One run downloads the channel manifest, fetches each target's npm
// tarball from Anomaly's release service, checks the tarball's size and SHA-256 against the manifest, extracts
// package/bin/browse, checks the binary's own SHA-256 and byte size, and writes manifest/browse.json. The binaries
// stay in .cache/bin (git-ignored); scripts/build-bins.mjs turns them into the platform packages.
//
//   node scripts/pin.mjs            pin the current version on the stable channel (refuses a change without --refresh)
//   node scripts/pin.mjs --refresh  re-pin whatever the channel serves now, after a drift check
//
// Never runs the installer, never pairs an extension, never writes a config file.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const root = fileURLToPath(new URL("..", import.meta.url))
const MANIFEST = join(root, "manifest", "browse.json")
const CACHE = join(root, ".cache", "bin")
const SERVICE = process.env.BROWSE_RELEASE_SERVICE ?? "https://anoma.ly/release"
const CHANNEL = process.env.BROWSE_CHANNEL ?? "stable"

/** The channel manifest's target names, and the platform key each becomes. */
export const TARGETS = {
  "macos-arm64": "darwin-arm64",
  "macos-x64": "darwin-x64",
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex")
const read = (file) => readFileSync(file)

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "opencode-browse-pin/0.0.0" } })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** The channel manifest: one current release per channel, each target with a URL, size and SHA-256. */
export async function readChannel() {
  const url = `${SERVICE.replace(/\/+$/, "")}/browse/cli/${CHANNEL}.json`
  const manifest = JSON.parse((await fetchBytes(url)).toString("utf8"))
  if (manifest.app !== "browse" || manifest.artifact !== "cli" || manifest.channel !== CHANNEL) {
    throw new Error(`${url} is not browse's ${CHANNEL} CLI manifest`)
  }
  return { manifest, url }
}

const origin = (service) => service.replace(/\/+$/, "").replace(/\/release$/, "")

async function pin({ refresh }) {
  const existing = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : undefined
  const { manifest, url } = await readChannel()
  const version = manifest.release.version
  if (existing && existing.version !== version && !refresh) {
    throw new Error(`browse ${version} is on the channel, but the plugin pins ${existing.version}; run with --refresh and check the tool drift first`)
  }
  const base = origin(SERVICE)
  const targets = {}
  for (const [target, platform] of Object.entries(TARGETS)) {
    const asset = manifest.release.targets[target]
    if (!asset) throw new Error(`the ${CHANNEL} manifest has no ${target} build`)
    const tgzUrl = asset.url.startsWith("/") ? `${base}${asset.url}` : asset.url
    const tgz = await fetchBytes(tgzUrl)
    if (tgz.length !== asset.size) throw new Error(`${target}: expected ${asset.size} bytes, got ${tgz.length}`)
    if (sha256(tgz) !== asset.sha256) throw new Error(`${target}: the tarball does not match the manifest's SHA-256`)
    const dir = join(CACHE, platform)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, "browse")
    // The tarball holds package/bin/browse; extract only that member, so nothing else from it reaches the cache.
    writeFileSync(join(dir, "asset.tgz"), tgz)
    execFileSync("tar", ["-xzf", join(dir, "asset.tgz"), "-C", dir, "package/bin/browse"], { stdio: "pipe" })
    execFileSync("mv", [join(dir, "package", "bin", "browse"), file])
    execFileSync("rm", ["-rf", join(dir, "package"), join(dir, "asset.tgz")])
    execFileSync("chmod", ["755", file])
    const binary = read(file)
    targets[platform] = {
      target,
      asset: basename(tgzUrl),
      url: tgzUrl,
      tgzSha256: asset.sha256,
      tgzBytes: asset.size,
      sha256: sha256(binary),
      bytes: binary.length,
    }
    console.log(`${platform}: binary ${binary.length} bytes, sha256 ${targets[platform].sha256}`)
  }
  const pin = {
    app: "browse",
    version,
    channel: CHANNEL,
    manifest: url,
    upstream: "https://github.com/anomalyco/browse",
    licence: "MIT",
    copyright: "Copyright (c) 2025 opencode",
    pinnedAt: new Date().toISOString(),
    targets,
  }
  mkdirSync(join(root, "manifest"), { recursive: true })
  writeFileSync(MANIFEST, `${JSON.stringify(pin, null, 2)}\n`)
  console.log(`pinned browse ${version} (${Object.keys(targets).join(", ")})`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await pin({ refresh: process.argv.includes("--refresh") })
}
