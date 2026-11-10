// The pinned browse binary this computer runs in the host and managed tests: the bytes manifest/browse.json pins,
// fetched and verified by `npm run bin:ensure` into .cache/bin. The tests pass it as the `path` option, so they exercise
// the real server without a release manifest in the working tree. The released binary's own resolution is covered by
// the unit tests (test/unit/engine.test.ts).
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { platformKey } from "../../src/engine.js"

export const projectRoot = fileURLToPath(new URL("../..", import.meta.url))

/** The pinned binary for this computer, or undefined when it is not installed yet (run `npm run bin:ensure`). */
export function pinnedBinary(): string | undefined {
  const key = platformKey()
  if (key === undefined) return undefined
  const path = join(projectRoot, ".cache", "bin", key, "browse")
  return existsSync(path) ? path : undefined
}
