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
    expect(main).toContain("`execute` asks")
    expect(main).toContain("the prompt is the yes")
    expect(main).not.toContain("wait for a yes")
    expect(main).not.toMatch(/"effect":\s*"allow"/)
    expect(main).toContain("Never type a password")
  })

  test("the capture skill says what is captured, where it goes, and what not to do", () => {
    const capture = read("browse-capture")
    expect(capture).toContain("outputPath")
    expect(capture).toContain("outside the repository")
    expect(capture).toContain("run without asking")
    expect(capture).toContain("never leave a capture or a recording running")
  })
})
