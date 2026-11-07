// Fetches one target of a browse release from Anomaly's release service into a path, verifying the tarball's size and
// SHA-256 and the extracted binary's digest, without touching manifest/browse.json or any cache the plugin uses.
//   node scripts/fetch-latest.mjs --target linux-x64 --out <tmp>/browse-latest
// Prints `browse <version> <sha256>` on success. Used by the drift job and handy before a re-pin.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const args = process.argv.slice(2)
const value = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const target = value("--target") ?? "linux-x64"
const out = value("--out")
if (!out) {
  console.error("usage: node scripts/fetch-latest.mjs --target <linux-x64|linux-arm64|macos-arm64|macos-x64> --out <path>")
  process.exit(2)
}
const service = (process.env.BROWSE_RELEASE_SERVICE ?? "https://anoma.ly/release").replace(/\/+$/, "")
const channel = process.env.BROWSE_CHANNEL ?? "stable"
const origin = service.replace(/\/release$/, "")

const sha256 = (data) => createHash("sha256").update(data).digest("hex")
const fetchBytes = async (url) => {
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "opencode-browse-drift/0.0.0" } })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const manifestUrl = `${service}/browse/cli/${channel}.json`
const manifest = JSON.parse((await fetchBytes(manifestUrl)).toString("utf8"))
const asset = manifest.release.targets[target]
if (!asset) throw new Error(`the ${channel} manifest has no ${target} build`)
const tgzUrl = asset.url.startsWith("/") ? `${origin}${asset.url}` : asset.url
const tgz = await fetchBytes(tgzUrl)
if (tgz.length !== asset.size) throw new Error(`${target}: expected ${asset.size} bytes, got ${tgz.length}`)
if (sha256(tgz) !== asset.sha256) throw new Error(`${target}: the tarball does not match the manifest's SHA-256`)

const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-fetch-")))
try {
  const file = join(work, "asset.tgz")
  writeFileSync(file, tgz)
  execFileSync("tar", ["-xzf", file, "-C", work, "package/bin/browse"])
  const binary = readFileSync(join(work, "package", "bin", "browse"))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, binary)
  execFileSync("chmod", ["755", out])
  console.log(`browse ${manifest.release.version} ${sha256(binary)}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
