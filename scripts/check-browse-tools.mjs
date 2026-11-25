// The drift check: compares the manifest's pass-through tools with the pinned browse release's own `tools/list`, and,
// with `--bin <path>`, with a binary you point it at (a new release, before re-pinning).
//   node scripts/check-browse-tools.mjs                 the committed fixture (test/fixtures/live-tools.json)
//   node scripts/check-browse-tools.mjs --bin ./browse  a capture from that binary, with a temp HOME and XDG dirs
// It reports tools added or removed and exits 1 on any drift: a tool the manifest does not classify has no class and no
// rule, so this plugin cannot say what it may do.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const capabilities = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).capabilities
const table = Object.keys(capabilities.methods)
  .filter((method) => method.startsWith("mcp:"))
  .map((method) => method.slice("mcp:".length))
const fail = (message) => {
  console.error(message)
  process.exitCode = 1
}

/** The pinned binary the probe runs: `.cache/bin` (the manifest's build output), which is git-ignored. */
function platformKey() {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64"
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64"
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64-gnu"
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64-gnu"
  return undefined
}

/**
 * The caller-isolation probe, after the table: two `_meta` session ids must give two sessions. It reports and never
 * fails the drift check, because isolation lands in a later browse release and this plugin's pin cannot provide it.
 */
function probeIsolation(binary) {
  try {
    execFileSync(process.execPath, [join(root, "scripts", "check-caller-isolation.mjs"), binary], { stdio: "inherit", timeout: 120_000 })
  } catch {
    console.log("caller isolation: isolates: unknown (the probe did not finish)")
  }
}

/** A capture is either the fixture's shape or a bare `{ tools }`. */
function toolsOf(capture) {
  return Array.isArray(capture?.tools) ? capture.tools : []
}

function compare(label, listed) {
  const names = new Set(listed.map((tool) => tool.name))
  const problems = []
  for (const tool of table) if (!names.has(tool)) problems.push(`- ${tool}: in capabilities.methods, not listed by ${label}`)
  for (const name of names) if (!table.includes(name)) problems.push(`- ${name}: listed by ${label}, not classified in capabilities.methods`)
  console.log(`${label}: ${listed.length} tools, ${table.length} classified`)
  if (problems.length === 0) {
    console.log(`same: the manifest matches ${label}`)
    return
  }
  for (const problem of problems) console.error(problem)
  fail(`${problems.length} difference(s) against ${label}. Classify each tool in package.json capabilities.methods, then update the fixture.`)
}

const binIndex = process.argv.indexOf("--bin")
if (binIndex !== -1) {
  const binary = process.argv[binIndex + 1]
  if (!binary) {
    console.error("--bin needs a path")
    process.exit(2)
  }
  const home = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-drift-")))
  const out = join(home, "tools.json")
  try {
    execFileSync(process.execPath, [join(root, "test", "fixtures", "capture-tools.mjs"), binary, out], { stdio: "inherit" })
    compare(binary, toolsOf(JSON.parse(readFileSync(out, "utf8"))))
    probeIsolation(binary)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
} else {
  compare("the pinned fixture", toolsOf(JSON.parse(readFileSync(join(root, "test", "fixtures", "live-tools.json"), "utf8"))))
  const key = platformKey()
  const pinned = key === undefined ? undefined : join(root, ".cache", "bin", key, "browse")
  if (pinned !== undefined && existsSync(pinned)) probeIsolation(pinned)
  else console.log("caller isolation: isolates: unknown (the pinned binary is not in .cache/bin)")
}
