// The release workflow builds the tag's native files, verifies them against the committed manifest and attaches them
// by exact name; the separate native workflow is gone.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const repo = fileURLToPath(new URL("../..", import.meta.url))
const workflow = parse(readFileSync(join(repo, ".github", "workflows", "release.yml"), "utf8")) as any
const runs = (job: any): string => (job.steps ?? []).map((step: any) => step.run ?? "").join("\n")
const nativeFiles = ["browse-darwin-arm64.gz", "browse-darwin-x64.gz", "browse-linux-arm64-gnu.gz", "browse-linux-x64-gnu.gz", "LICENSE.browse", "native.json"]

describe("the release workflow", () => {
  test("has a native job with no guard that builds and verifies the tag's files", () => {
    const native = workflow.jobs.native
    expect(native).toBeDefined()
    expect(native.if).toBeUndefined()
    expect(runs(native)).toContain("scripts/build-native.mjs")
    expect(runs(native)).toContain("scripts/verify-native.mjs")
    expect(native.permissions).toMatchObject({ contents: "read", "id-token": "write", attestations: "write" })
    expect(JSON.stringify(native.steps)).toContain("attest-build-provenance")
  })

  test("publish waits for check and native, and names all six native files exactly", () => {
    expect(workflow.jobs.publish.needs).toEqual(expect.arrayContaining(["check", "native"]))
    const command = runs(workflow.jobs.publish)
    for (const name of nativeFiles) expect(command).toContain(name)
    expect(command).toContain("./*.tgz conformance.json SHA256SUMS")
    expect(command).not.toMatch(/native-files\/\*/)
  })

  test("the old separate native workflow is gone", () => {
    expect(existsSync(join(repo, ".github", "workflows", "native.yml"))).toBe(false)
  })
})
