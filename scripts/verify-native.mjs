// Verifies the tag-time native release build against the committed `manifest/native.json`, then stages exactly the
// files the GitHub release attaches: the module gzips, the licence files and a tag-time `native.json`.
//
//   node scripts/verify-native.mjs --built <dir> --committed manifest/native.json --out <dir> --tag v0.0.0 \
//     --repository <owner/repo> --commit <40-hex sha> --run <id>
//
// The committed manifest is the pin. The candidate `native-manifest.json` that `scripts/build-native.mjs` wrote must
// pin the same assets, and its `built` record must name this run; the committed `built` fields are deliberately not
// trusted. Every gzip is decompressed and checked against the committed executable, and the built directory must hold
// exactly the expected files, so a stale or partially replaced build cannot be published.
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync } from "node:zlib"

const HEX40 = /^[a-f0-9]{40}$/
const HEX64 = /^[a-f0-9]{64}$/
const MANIFEST = "native-manifest.json"

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const fail = (what) => {
  throw new Error(`verify-native: ${what}`)
}

const plain = (value, field) => {
  if (typeof value !== "string" || value === "" || value.includes("/") || value.includes("\\") || value === "." || value === "..") fail(`${field} is not a plain file name`)
  return value
}

const positive = (value, field) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) fail(`${field} is not a positive integer`)
  return value
}

const digest = (value, field) => {
  if (typeof value !== "string" || !HEX64.test(value)) fail(`${field} is not a sha256`)
  return value
}

const text = (value, field) => {
  if (typeof value !== "string" || value === "") fail(`${field} is empty`)
  return value
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    fail(`${label} cannot be read as JSON (${error instanceof Error ? error.message : String(error)})`)
  }
}

function shape(manifest, label) {
  if (!isRecord(manifest)) fail(`${label} is not an object`)
  if (manifest.schema !== 1) fail(`${label} has an unknown schema`)
  text(manifest.plugin, `${label}.plugin`)
  if (!/^[\w.-]+\/[\w.-]+$/.test(text(manifest.repository, `${label}.repository`))) fail(`${label}.repository is not owner/name`)
  text(manifest.tag, `${label}.tag`)
  if (!isRecord(manifest.modules)) fail(`${label}.modules is not an object`)
  if (!Array.isArray(manifest.licences)) fail(`${label}.licences is not an array`)
}

function entry(value, label) {
  if (!isRecord(value)) fail(`${label} is not an object`)
  const name = plain(value.name, `${label}.name`)
  text(value.url, `${label}.url`)
  const bytes = positive(value.bytes, `${label}.bytes`)
  const sum = digest(value.sha256, `${label}.sha256`)
  return { name, url: value.url, bytes, sha256: sum, ...(value.executable === undefined ? {} : { executable: executable(value.executable, `${label}.executable`) }) }
}

function executable(value, label) {
  if (!isRecord(value)) fail(`${label} is not an object`)
  return { name: plain(value.name, `${label}.name`), bytes: positive(value.bytes, `${label}.bytes`), sha256: digest(value.sha256, `${label}.sha256`) }
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function sameEntry(left, right, label) {
  if (!same(left, right)) fail(`${label} differs from the committed manifest`)
}

/** Every module asset and licence in the committed manifest, keyed by its file name. */
function expected(manifest, repository, tag, label) {
  const assets = new Map()
  for (const [module, platforms] of Object.entries(manifest.modules)) {
    if (!isRecord(platforms)) fail(`committed module ${module} is not an object`)
    for (const [platform, value] of Object.entries(platforms)) {
      const itemLabel = `${label} ${module}/${platform}`
      const item = entry(value, itemLabel)
      const url = `https://github.com/${repository}/releases/download/${tag}/${item.name}`
      if (item.url !== url) fail(`${itemLabel} (${item.name}).url is not ${url}`)
      if (item.executable === undefined) fail(`${itemLabel} has no executable`)
      if (assets.has(item.name)) fail(`the committed manifest names ${item.name} twice`)
      assets.set(item.name, { ...item, module, platform, kind: "module" })
    }
  }
  const licences = new Map()
  for (const [index, value] of manifest.licences.entries()) {
    const itemLabel = `${label} licence ${index}`
    const item = entry(value, itemLabel)
    const url = `https://github.com/${repository}/releases/download/${tag}/${item.name}`
    if (item.url !== url) fail(`${itemLabel} (${item.name}).url is not ${url}`)
    if (assets.has(item.name) || licences.has(item.name)) fail(`the committed manifest names ${item.name} twice`)
    licences.set(item.name, { ...item, kind: "licence" })
  }
  return { assets, licences }
}

function compare(committed, candidate, repository, tag) {
  shape(committed, "committed manifest")
  shape(candidate, "candidate manifest")
  if (committed.repository !== repository) fail(`committed repository is ${committed.repository}, not ${repository}`)
  if (committed.tag !== tag) fail(`committed tag is ${committed.tag}, not ${tag}`)
  const plugin = repository.slice(repository.indexOf("/") + 1)
  if (committed.plugin !== plugin) fail(`committed plugin is ${committed.plugin}, not ${plugin}`)
  for (const field of ["schema", "plugin", "repository", "tag"]) if (committed[field] !== candidate[field]) fail(`candidate ${field} differs from the committed manifest`)

  const pinned = expected(committed, repository, tag, "committed")
  const built = expected(candidate, repository, tag, "candidate")
  if (pinned.assets.size !== built.assets.size) fail("candidate module count differs from the committed manifest")
  if (pinned.licences.size !== built.licences.size) fail("candidate licence count differs from the committed manifest")
  for (const [name, item] of pinned.assets) {
    const other = built.assets.get(name)
    if (other === undefined) fail(`candidate is missing ${name}`)
    sameEntry(item, other, `candidate ${name}`)
    if (item.module !== other.module || item.platform !== other.platform) fail(`candidate ${name} moved module or platform`)
  }
  for (const [name, item] of pinned.licences) {
    const other = built.licences.get(name)
    if (other === undefined) fail(`candidate is missing ${name}`)
    sameEntry(item, other, `candidate ${name}`)
  }
  return { pinned, candidate }
}

function verifyFiles(builtDir, pinned, candidate, commit, run) {
  const built = candidate.built
  if (!isRecord(built)) fail("candidate built is not an object")
  if (built.commit !== commit) fail(`candidate built.commit is ${built.commit}, not ${commit}`)
  if (built.run !== Number(run)) fail(`candidate built.run is ${built.run}, not ${Number(run)}`)
  if (built.workflow !== "native") fail(`candidate built.workflow is ${built.workflow}, not native`)

  const expectedNames = new Set([...pinned.assets.keys(), ...pinned.licences.keys()])
  const found = new Map()
  for (const dirent of readdirSync(builtDir, { withFileTypes: true })) {
    if (!dirent.isFile()) fail(`built directory holds ${dirent.name}, which is not a regular file`)
    found.set(dirent.name, dirent.name)
  }
  const wanted = new Set([...expectedNames, MANIFEST])
  for (const name of wanted) if (!found.has(name)) fail(`built directory is missing ${name}`)
  for (const name of found.keys()) if (!wanted.has(name)) fail(`built directory has an unexpected file ${name}`)

  for (const [name, item] of [...pinned.assets, ...pinned.licences]) {
    const path = join(builtDir, name)
    const bytes = readFileSync(path)
    const size = statSync(path).size
    if (size !== item.bytes) fail(`${name} is ${size} bytes, not ${item.bytes}`)
    if (sha256(bytes) !== item.sha256) fail(`${name} does not match its committed sha256`)
    if (item.kind === "module") {
      let decompressed
      try {
        decompressed = gunzipSync(bytes)
      } catch (error) {
        fail(`${name} does not gunzip (${error instanceof Error ? error.message : String(error)})`)
      }
      if (decompressed.byteLength !== item.executable.bytes) fail(`${name} decompresses to ${decompressed.byteLength} bytes, not ${item.executable.bytes}`)
      if (sha256(decompressed) !== item.executable.sha256) fail(`${name} decompresses to the wrong executable sha256`)
    }
  }
  return [...expectedNames, MANIFEST]
}

/**
 * Verify one tag-time native build and stage the six release files. Throws before touching `out` on any mismatch.
 */
export function verifyNative({ built, committed, out, tag, repository, commit, run }) {
  if (!HEX40.test(commit ?? "")) fail("commit is not a 40-hex sha")
  if (!/^\d+$/.test(String(run ?? ""))) fail("run is not a number")
  if (resolve(built) === resolve(out)) fail("--out must differ from --built")

  const committedManifest = readJson(committed, "committed manifest")
  const candidatePath = join(built, MANIFEST)
  const candidate = readJson(candidatePath, "candidate manifest")
  const { pinned } = compare(committedManifest, candidate, repository, tag)
  const names = verifyFiles(built, pinned, candidate, commit, run)

  const candidateBytes = readFileSync(candidatePath)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const name of names) {
    if (name === MANIFEST) continue
    copyFileSync(join(built, name), join(out, name))
    const item = pinned.assets.get(name) ?? pinned.licences.get(name)
    console.log(`verified: ${name} ${item.bytes} bytes ${item.sha256}`)
  }
  writeFileSync(join(out, "native.json"), candidateBytes)
  console.log(`staged: ${names.filter((name) => name !== MANIFEST).length} native files and native.json in ${out}`)
  return { staged: [...names.filter((name) => name !== MANIFEST), "native.json"], manifest: candidate }
}

function parse(argv) {
  const flags = { built: undefined, committed: undefined, out: undefined, tag: undefined, repository: undefined, commit: undefined, run: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--built") flags.built = argv[++index]
    else if (arg === "--committed") flags.committed = argv[++index]
    else if (arg === "--out") flags.out = argv[++index]
    else if (arg === "--tag") flags.tag = argv[++index]
    else if (arg === "--repository") flags.repository = argv[++index]
    else if (arg === "--commit") flags.commit = argv[++index]
    else if (arg === "--run") flags.run = argv[++index]
    else throw new Error(`unknown argument ${arg}`)
  }
  for (const name of ["built", "committed", "out", "tag", "repository", "commit", "run"]) if (flags[name] === undefined) throw new Error(`--${name} is required`)
  return flags
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const flags = parse(process.argv.slice(2))
    verifyNative({ built: resolve(flags.built), committed: resolve(flags.committed), out: resolve(flags.out), tag: flags.tag, repository: flags.repository, commit: flags.commit, run: flags.run })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
