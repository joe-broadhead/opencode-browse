// Builds the platform packages from the pinned binaries in .cache/bin and manifest/browse.json.
//   node scripts/build-bins.mjs           write each package under dist-packages/
//   node scripts/build-bins.mjs --local   also install this computer's package into node_modules, for the tests
//   node scripts/build-bins.mjs --pack    also write each package's .tgz beside it
// Each package ships bin/browse, manifest/browse.json (the binary's SHA-256 and size), LICENSE.browse and NOTICE.
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const OUT = join(root, "dist-packages")
const CACHE = join(root, ".cache", "bin")
const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version

/** The package name and os/cpu fields for each platform key. */
export const PLATFORMS = {
  "darwin-arm64": { os: ["darwin"], cpu: ["arm64"] },
  "darwin-x64": { os: ["darwin"], cpu: ["x64"] },
  "linux-x64-gnu": { os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
  "linux-arm64-gnu": { os: ["linux"], cpu: ["arm64"], libc: ["glibc"] },
}

const packageName = (platform) => `@joe-broadhead/opencode-browse-bin-${platform}`
const license = readFileSync(join(root, "vendor", "LICENSE.browse"), "utf8")
const notice = readFileSync(join(root, "NOTICE"), "utf8")

function build(platform, fields) {
  const target = pin.targets[platform]
  if (target === undefined) throw new Error(`manifest/browse.json has no ${platform}`)
  const binary = join(CACHE, platform, "browse")
  if (!existsSync(binary)) throw new Error(`${binary} is missing; run node scripts/pin.mjs first`)
  const dir = join(OUT, `opencode-browse-bin-${platform}`)
  rmSync(dir, { recursive: true, force: true })
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
  writeFileSync(join(dir, "NOTICE"), notice)
  return dir
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const built = {}
for (const [platform, fields] of Object.entries(PLATFORMS)) built[platform] = build(platform, fields)
console.log(`built ${Object.keys(built).length} platform packages in dist-packages/`)

if (process.argv.includes("--pack")) {
  for (const dir of Object.values(built)) {
    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", join(root, "dist-packages")], { cwd: dir, stdio: "pipe" })
  }
  console.log("packed each platform package")
}

if (process.argv.includes("--local")) {
  const key = process.platform === "darwin" ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64") : process.arch === "arm64" ? "linux-arm64-gnu" : "linux-x64-gnu"
  const target = join(root, "node_modules", "@joe-broadhead", `opencode-browse-bin-${key}`)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(join(root, "node_modules", "@joe-broadhead"), { recursive: true })
  execFileSync("cp", ["-R", built[key], target])
  console.log(`installed ${packageName(key)} into node_modules`)
}

export { build, packageName }
