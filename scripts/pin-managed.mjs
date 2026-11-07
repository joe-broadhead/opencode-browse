// Pins the two artefacts managed mode needs:
//   managed-extension/      browse's built extension, unpacked from the release service's stable zip (MIT, 0.0.14)
//   manifest/extension.json the zip's SHA-256 and size, and every shipped file's SHA-256 and size
//   manifest/chromium.json  a Chrome for Testing version, and for each platform the download URL, size and SHA-256 we
//                           measured ourselves (CfT publishes no hashes)
//
//   node scripts/pin-managed.mjs             pin the current stable extension and the latest CfT stable
//   node scripts/pin-managed.mjs --refresh   re-pin both, after review
//
// Downloads are streamed to a hash, never kept. Nothing is installed or launched.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const ARTIFACTS = join(root, "manifest")
const EXTENSION_DIR = join(root, "managed-extension")
const SERVICE = process.env.BROWSE_RELEASE_SERVICE ?? "https://anoma.ly/release"
const CHANNEL = process.env.BROWSE_CHANNEL ?? "stable"
const CFT_API = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"

/** CfT platform names, and the plugin platform keys they serve. */
export const CFT_PLATFORMS = {
  "mac-arm64": "darwin-arm64",
  "mac-x64": "darwin-x64",
  linux64: "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
}

/** browse's public unpacked-extension key (public/manifest.json at 0.0.14); Chrome derives the pinned id from it. */
const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjWdgsBDUPCHO2u5bq3/Us1sLm+kiehLZBL0HIu3stwivGW+bgCDsD8KAEMFJcY04u3iudffTeEGdEe8pQfL7BSNRvyslszmvJrsoP7bVUKXrnRTw3CUsRjnwbqMoMElwegiCFUXPnqQ9ZeA2NGEhmWMyDXqqZxOo0z2q66GTgz9McbXOBK2QXYBPjUWxud814wSrE1lIQ2G58nQVeZenI3/PXZ4f1SACn6SdkiCR44NZwz89I1ISxftongLDED/1dlnivqJBzAtN1s2i+jWplLtOmLJJkh1LQ2jP3gWvYY1zT2RHJIw874SSrrhFt4Hguvo/L0Ge7ixvGp5tDAP2wwIDAQAB"

const sha256 = (data) => createHash("sha256").update(data).digest("hex")
const fetchBytes = async (url) => {
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "opencode-browse-pin/0.0.0" } })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Downloads a 150 MB zip to a temporary file once, measures it, and removes it. */
function measured(url) {
  const file = join(ARTIFACTS, `cft-${process.pid}.zip`)
  try {
    execFileSync("curl", ["-fsSL", "--max-time", "900", "-o", file, url])
    const data = readFileSync(file)
    if (data.length < 1_000_000) throw new Error(`${url}: only ${data.length} bytes`)
    return { sha256: sha256(data), bytes: data.length }
  } finally {
    rmSync(file, { force: true })
  }
}

async function pinExtension() {
  const manifestUrl = `${SERVICE.replace(/\/+$/, "")}/browse/extension/${CHANNEL}.json`
  const manifest = JSON.parse((await fetchBytes(manifestUrl)).toString("utf8"))
  const asset = manifest.release.targets.chromium
  if (!asset) throw new Error(`${manifestUrl} has no chromium target`)
  const origin = SERVICE.replace(/\/+$/, "").replace(/\/release$/, "")
  const url = asset.url.startsWith("/") ? `${origin}${asset.url}` : asset.url
  const zip = await fetchBytes(url)
  if (zip.length !== asset.size) throw new Error(`extension: expected ${asset.size} bytes, got ${zip.length}`)
  if (sha256(zip) !== asset.sha256) throw new Error("extension: the zip does not match the manifest's SHA-256")

  rmSync(EXTENSION_DIR, { recursive: true, force: true })
  mkdirSync(EXTENSION_DIR, { recursive: true })
  const zipPath = join(ARTIFACTS, "extension.zip")
  writeFileSync(zipPath, zip)
  try {
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", EXTENSION_DIR])
  } finally {
    rmSync(zipPath, { force: true })
  }
  // The store zip's manifest carries no `key`, so Chrome would derive an id from the folder path and the relay would
  // refuse its WebSocket origin. browse's public unpacked build carries this key; adding it gives the pinned id
  // `afeafocngkodbmaipcngoamamfmekgfo`, which the relay accepts.
  const manifestPath = join(EXTENSION_DIR, "manifest.json")
  const manifestJson = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (typeof manifestJson.key !== "string" || manifestJson.key === "") {
    manifestJson.key = EXTENSION_KEY
    writeFileSync(manifestPath, `${JSON.stringify(manifestJson, null, 2)}\n`)
  }
  const version = manifestJson.version
  if (version !== manifest.release.version) throw new Error(`extension: manifest says ${version}, the channel says ${manifest.release.version}`)
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const data = readFileSync(path)
        files.push({ path: relative(EXTENSION_DIR, path).split(sep).join("/"), sha256: sha256(data), bytes: data.length })
      }
    }
  }
  walk(EXTENSION_DIR)
  files.sort((a, b) => (a.path < b.path ? -1 : 1))
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const pin = {
    app: "browse",
    artifact: "extension",
    version,
    channel: CHANNEL,
    manifest: manifestUrl,
    upstream: "https://github.com/anomalyco/browse",
    licence: "MIT",
    copyright: "Copyright (c) 2025 opencode",
    zip: { url, sha256: asset.sha256, bytes: asset.size },
    totalBytes,
    files,
    pinnedAt: new Date().toISOString(),
  }
  writeFileSync(join(ARTIFACTS, "extension.json"), `${JSON.stringify(pin, null, 2)}\n`)
  console.log(`extension ${version}: ${files.length} files, ${totalBytes} bytes, zip sha256 ${asset.sha256}`)
  return pin
}

async function pinChromium() {
  const existing = existsSync(join(ARTIFACTS, "chromium.json")) ? JSON.parse(readFileSync(join(ARTIFACTS, "chromium.json"), "utf8")) : undefined
  const cft = JSON.parse((await fetchBytes(CFT_API)).toString("utf8"))
  const stable = cft.channels?.Stable
  if (!stable?.version) throw new Error("the CfT API has no stable channel")
  const version = existing && !process.argv.includes("--refresh") ? existing.version : stable.version
  if (existing && existing.version === version && !process.argv.includes("--refresh")) {
    console.log(`chromium ${version}: already pinned`)
    return existing
  }
  const downloads = new Map(stable.downloads.chrome.map((entry) => [entry.platform, entry.url]))
  const latest = stable.version
  const base = `https://storage.googleapis.com/chrome-for-testing-public/${version}`
  const platforms = {}
  for (const [cftPlatform, key] of Object.entries(CFT_PLATFORMS)) {
    // A pinned version older than the latest has the same URL shape; rebuild it rather than trusting `stable`'s URLs.
    const url = version === latest ? downloads.get(cftPlatform) : `${base}/${cftPlatform}/chrome-${cftPlatform}.zip`
    if (!url) {
      console.log(`chromium ${version}: no ${cftPlatform} build; managed mode will not support ${key}`)
      continue
    }
    const size = measured(url)
    platforms[key] = { cftPlatform, url, sha256: size.sha256, bytes: size.bytes }
    console.log(`chromium ${version} ${cftPlatform} (${key}): ${size.bytes} bytes, sha256 ${size.sha256}`)
  }
  const pin = {
    app: "chrome-for-testing",
    version,
    source: "https://googlechromelabs.github.io/chrome-for-testing/",
    licence: "Chrome for Testing is distributed by Google under its own terms; the plugin downloads it on demand and does not ship it.",
    platforms,
    pinnedAt: new Date().toISOString(),
  }
  writeFileSync(join(ARTIFACTS, "chromium.json"), `${JSON.stringify(pin, null, 2)}\n`)
  console.log(`pinned Chrome for Testing ${version} for ${Object.keys(platforms).join(", ")}`)
  return pin
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes("--chromium")) await pinExtension()
  if (!process.argv.includes("--extension")) await pinChromium()
}
