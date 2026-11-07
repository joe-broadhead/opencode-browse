// Imported first, before anything loads OpenCode. OpenCode derives its global paths from the environment, and under
// Bun os.homedir() ignores a changed HOME, so the whole environment is replaced: HOME, OPENCODE_TEST_HOME, XDG_* and
// TMPDIR point into a fresh temp root, nothing else is inherited (no parent OpenCode, provider key or proxy), and the
// working directory moves there too, because the host also opens a location at it. The root is a git repository under
// the system's /tmp, never under TMPDIR or HOME: OpenCode looks for `.opencode` folders and project config upwards
// from a location, and stops at the repository's root, so it never finds the agents or skills of whoever runs the test.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"

/** A folder whose node_modules holds another @opencode/sdk 2.2.x, such as 2.2.4, to host the suite instead. */
export const HOST_SDK_DIR = process.env.HOST_SDK_DIR ? resolve(process.env.HOST_SDK_DIR) : undefined
export const ROOT = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-host-")))
const init = spawnSync("git", ["init", "--quiet", ROOT], { encoding: "utf8" })
if (init.status !== 0) throw new Error(`git init ${ROOT} failed: ${init.stderr}`)
const home = join(ROOT, "home")
const KEEP = ["PATH", "LANG", "TZ", "TERM"]
for (const key of Object.keys(process.env)) if (!KEEP.includes(key) && !key.startsWith("BUN_")) delete process.env[key]
Object.assign(process.env, {
  HOME: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  TMPDIR: join(ROOT, "tmp"),
})
for (const dir of [home, join(ROOT, "tmp")]) mkdirSync(dir, { recursive: true })
process.chdir(home)

/**
 * A free port for this run's relay. Every test that runs the pinned binary uses it: browse's relay daemonises, and a
 * test relay on browse's default 19988 would collide with a user's own relay and extension.
 */
export const RELAY_PORT = (() => {
  const result = spawnSync(process.execPath, [
    "-e",
    'const s = require("node:net").createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close() })',
  ], { encoding: "utf8" })
  const port = Number(String(result.stdout ?? "").trim())
  if (!Number.isInteger(port) || port <= 0 || port === 19988) throw new Error(`could not pick a free relay port, got ${String(result.stdout).trim()}`)
  return port
})()
process.env.OPENCODE_BROWSER_PORT = String(RELAY_PORT)
