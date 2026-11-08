import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { TOOL_NAMES } from "../../src/browse-tools.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const names = ["browse", "browse-capture"]
const read = (name: string) => readFileSync(join(root, "skills", name, "SKILL.md"), "utf8")
const frontmatter = (text: string) => /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ""

describe("the shipped skills", () => {
  test("are the two the declaration names, under 100 lines, with frontmatter", () => {
    for (const name of names) {
      const text = read(name)
      expect(text.split("\n").length, name).toBeLessThanOrEqual(100)
      const fields = frontmatter(text)
      expect(fields).toContain(`name: ${name}`)
      expect(fields).toMatch(/^description: .{40,}$/m)
      expect(text.trimEnd()).not.toContain("\n\n\n")
    }
  })

  test("name only real tools, and every tool they name is real", () => {
    for (const name of names) {
      const text = read(name)
      for (const mentioned of text.matchAll(/`?browse_([a-z_]+)`?/g)) {
        const tool = mentioned[1]!
        if (tool === "tools") continue
        expect(TOOL_NAMES, `${name} names browse_${tool}`).toContain(tool)
      }
    }
  })

  test("route elsewhere rather than duplicating a neighbour", () => {
    const main = read("browse")
    expect(main).toContain("webfetch")
    expect(main).toContain("Tavily")
    expect(main).toContain("built-in `browser` tools")
  })

  test("say what the prompts mean, and never advise an allow for a write", () => {
    const main = read("browse")
    expect(main).toContain("Every tool runs by default")
    expect(main).toContain("the prompt is the yes")
    expect(main).not.toContain("`execute` asks on every call")
    expect(main).not.toContain("off until this plugin classifies")
    expect(main).not.toContain("wait for a yes")
    expect(main).not.toMatch(/"effect":\s*"allow"/)
    expect(main).toContain("Never type a password")
  })

  // Item 16: the model-facing text states the default truth, and the two traps the live evaluation found.
  test("tell the model to call browse_execute from Code Mode, and to make its own session", () => {
    const main = read("browse")
    expect(main).toContain("In Code Mode, Playwright code never goes straight into Code Mode's `execute`")
    expect(main).toContain('await tools.browse.execute({ code: "return page.url()" })')
    expect(main).toContain("Agents do not get separate browse sessions")
    expect(main).toContain("`browse_session_reset` it")
  })

  test("the capture skill says what is captured, where it goes, and what not to do", () => {
    const capture = read("browse-capture")
    expect(capture).toContain("outputPath")
    expect(capture).toContain("outside the repository")
    expect(capture).toContain("run without asking")
    expect(capture).toContain("never leave a capture or a recording running")
  })
})
