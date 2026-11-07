// Release preflight: every published platform package at this version must carry the same binary digest as this
// repo's pin. `npm view` only proves a version number exists; this downloads each tarball and reads its
// manifest/browse.json.
//   node scripts/verify-platform-packages.mjs <version>
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const version = process.argv[2]
if (!version) {
  console.error("usage: node scripts/verify-platform-packages.mjs <version>")
  process.exit(2)
}
const pin = JSON.parse(readFileSync(join(root, "manifest", "browse.json"), "utf8"))
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-verify-")))
const problems = []
try {
  for (const [platform, target] of Object.entries(pin.targets)) {
    const name = `@joe-broadhead/opencode-browse-bin-${platform}`
    try {
      const output = execFileSync("npm", ["pack", `${name}@${version}`, "--pack-destination", work, "--silent"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      const tarball = join(work, output.trim().split("\n").at(-1))
      const manifest = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/manifest/browse.json"], { encoding: "utf8" }))
      if (manifest.version !== pin.version) problems.push(`${name}@${version} ships browse ${manifest.version}, the pin says ${pin.version}`)
      if (manifest.sha256 !== target.sha256) problems.push(`${name}@${version} records sha256 ${manifest.sha256}, the pin says ${target.sha256}`)
      if (manifest.bytes !== target.bytes) problems.push(`${name}@${version} records ${manifest.bytes} bytes, the pin says ${target.bytes}`)
      console.log(`ok: ${name}@${version} carries the pinned ${manifest.sha256.slice(0, 12)}…`)
    } catch (error) {
      problems.push(`${name}@${version} could not be checked (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`)
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
for (const problem of problems) console.error(`::error::${problem}`)
if (problems.length) {
  console.error("Publish the platform packages for this version from dist-packages/ first, then rerun.")
  process.exit(1)
}
console.log(`all ${Object.keys(pin.targets).length} platform packages carry the pinned browse ${pin.version}`)
