// The release verifier (scripts/verify-native.mjs): a tag-time native build must match the committed
// manifest/native.json, decompress to the pinned executable, and stage exactly the six release files.
import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { verifyNative } from "../../scripts/verify-native.mjs"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64-gnu", "linux-x64-gnu"] as const
const tag = "v0.0.0"
const repository = "we-the-rebel-alliance/browse-plugin"
const commit = "a".repeat(40)
const run = "42"

interface Fixture {
  readonly root: string
  readonly built: string
  readonly out: string
  readonly committedPath: string
  readonly candidatePath: string
  readonly committed: any
  readonly candidate: any
}

/** A complete synthetic native build: four gzips, LICENSE.browse, the committed pin and the candidate manifest. */
function fixture(mutate: (state: Fixture) => void = () => undefined, gzipFor: (platform: string, bytes: Buffer) => Buffer = (_platform, bytes) => gzipSync(bytes, { level: 9 })): Fixture {
  const root = mkdtempSync(join(tmpdir(), "browse-verify-native-"))
  roots.push(root)
  const built = join(root, "built")
  mkdirSync(built, { recursive: true })
  const modules: Record<string, Record<string, unknown>> = { browse: {} }
  for (const platform of platforms) {
    const bytes = Buffer.from(`executable-${platform}`)
    const gz = gzipFor(platform, bytes)
    const name = `browse-${platform}.gz`
    writeFileSync(join(built, name), gz)
    modules.browse![platform] = {
      name,
      url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
      bytes: gz.length,
      sha256: sha(gz),
      executable: { name: "browse", bytes: bytes.length, sha256: sha(bytes) },
    }
  }
  const licence = Buffer.from("licence text")
  writeFileSync(join(built, "LICENSE.browse"), licence)
  const committed = {
    schema: 1,
    plugin: "browse-plugin",
    repository,
    tag,
    built: { commit: "b".repeat(40), run: 1, workflow: "native" },
    modules,
    licences: [{ name: "LICENSE.browse", url: `https://github.com/${repository}/releases/download/${tag}/LICENSE.browse`, bytes: licence.length, sha256: sha(licence) }],
  }
  const candidate = JSON.parse(JSON.stringify(committed))
  candidate.built = { commit, run: Number(run), workflow: "native" }
  const committedPath = join(root, "committed.json")
  const candidatePath = join(built, "native-manifest.json")
  const state: Fixture = { root, built, out: join(root, "out"), committedPath, candidatePath, committed, candidate }
  mutate(state)
  writeFileSync(committedPath, JSON.stringify(state.committed))
  writeFileSync(candidatePath, JSON.stringify(state.candidate))
  return state
}

const verify = (state: Fixture) =>
  verifyNative({ built: state.built, committed: state.committedPath, out: state.out, tag, repository, commit, run })

const names = (directory: string) => (existsSync(directory) ? readdirSync(directory).sort() : [])

describe("verify-native", () => {
  test("a valid build stages exactly the four gzips, the licence and the tag-time native.json", () => {
    const state = fixture()
    const result = verify(state)
    expect(result.staged).toEqual([...platforms.map((platform) => `browse-${platform}.gz`), "LICENSE.browse", "native.json"])
    expect(names(state.out)).toEqual(["LICENSE.browse", ...platforms.map((platform) => `browse-${platform}.gz`), "native.json"].sort())
    expect(JSON.parse(readFileSync(join(state.out, "native.json"), "utf8"))).toEqual(state.candidate)
    expect(JSON.parse(readFileSync(join(state.out, "native.json"), "utf8")).built).toEqual({ commit, run: Number(run), workflow: "native" })
  })

  test("refuses a gzip whose bytes or size do not match the committed pin", () => {
    const wrong = fixture()
    writeFileSync(join(wrong.built, "browse-darwin-arm64.gz"), Buffer.from("not the release gzip"))
    expect(() => verify(wrong)).toThrow(/browse-darwin-arm64\.gz is .* bytes|does not match its committed sha256/)
    expect(names(wrong.out)).toEqual([])
  })

  test("refuses a gzip that decompresses to a different executable", () => {
    const wrong = fixture(undefined, () => gzipSync(Buffer.from("not the pinned executable"), { level: 9 }))
    expect(() => verify(wrong)).toThrow(/decompresses to .* bytes|decompresses to the wrong executable sha256/)
  })

  test("refuses a candidate manifest with another tag or repository", () => {
    const wrongTag = fixture((state) => {
      state.candidate.tag = "v9.9.9"
    })
    expect(() => verify(wrongTag)).toThrow(/candidate tag differs from the committed manifest/)
    const wrongRepository = fixture((state) => {
      state.candidate.repository = "other/browse-plugin"
    })
    expect(() => verify(wrongRepository)).toThrow(/candidate repository differs from the committed manifest/)
    const wrongPin = fixture((state) => {
      state.committed.tag = "v9.9.9"
      state.candidate.tag = "v9.9.9"
    })
    expect(() => verify(wrongPin)).toThrow(/committed tag is v9\.9\.9, not v0\.0\.0/)
  })

  test("refuses candidate drift in a url, size, sha256 or executable pin", () => {
    const url = fixture((state) => {
      state.candidate.modules.browse["darwin-arm64"].url = "https://example.invalid/browse.gz"
    })
    expect(() => verify(url)).toThrow(/candidate browse\/darwin-arm64 \(browse-darwin-arm64\.gz\)\.url is not/)
    const bytes = fixture((state) => {
      state.candidate.modules.browse["darwin-arm64"].bytes += 1
    })
    expect(() => verify(bytes)).toThrow(/candidate browse-darwin-arm64\.gz differs/)
    const sum = fixture((state) => {
      state.candidate.modules.browse["darwin-arm64"].sha256 = "c".repeat(64)
    })
    expect(() => verify(sum)).toThrow(/candidate browse-darwin-arm64\.gz differs/)
    const executable = fixture((state) => {
      state.candidate.modules.browse["darwin-arm64"].executable.sha256 = "d".repeat(64)
    })
    expect(() => verify(executable)).toThrow(/candidate browse-darwin-arm64\.gz differs/)
  })

  test("refuses a missing or unexpected file in the built directory", () => {
    const missing = fixture()
    rmSync(join(missing.built, "browse-linux-x64-gnu.gz"))
    expect(() => verify(missing)).toThrow(/missing browse-linux-x64-gnu\.gz/)
    const extra = fixture()
    writeFileSync(join(extra.built, "extra.gz"), "extra")
    expect(() => verify(extra)).toThrow(/unexpected file extra\.gz/)
  })

  test("refuses a licence that does not match its committed entry", () => {
    const wrong = fixture()
    writeFileSync(join(wrong.built, "LICENSE.browse"), "another licence")
    expect(() => verify(wrong)).toThrow(/LICENSE\.browse is .* bytes|does not match its committed sha256/)
  })

  test("refuses a candidate built record for another commit, run or workflow", () => {
    const wrongCommit = fixture((state) => {
      state.candidate.built.commit = "e".repeat(40)
    })
    expect(() => verify(wrongCommit)).toThrow(/candidate built\.commit/)
    const wrongRun = fixture((state) => {
      state.candidate.built.run = 7
    })
    expect(() => verify(wrongRun)).toThrow(/candidate built\.run/)
    const wrongWorkflow = fixture((state) => {
      state.candidate.built.workflow = "other"
    })
    expect(() => verify(wrongWorkflow)).toThrow(/candidate built\.workflow/)
  })
})
