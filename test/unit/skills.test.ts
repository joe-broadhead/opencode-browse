// The shipped skills are read from the package's `skills/` folder and registered through `ctx.skill.transform`; a
// missing or broken file is a status problem, never a plugin that fails to load.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadSkills, parseSkill, SKILL_NAMES } from "../../src/skills.js"

const root = mkdtempSync(join(tmpdir(), "browse-skills-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("the shipped skills", () => {
  test("are the two the plugin declares, with a name and a description", async () => {
    const { skills, problems } = await loadSkills()
    expect(problems).toEqual([])
    expect(skills.map((skill) => String(skill.name))).toEqual([...SKILL_NAMES])
    for (const skill of skills) expect((skill.description ?? "").length).toBeLessThanOrEqual(300)
  })
})

describe("parseSkill", () => {
  const path = join(root, "browse", "SKILL.md")
  mkdirSync(join(root, "browse"), { recursive: true })

  test("reads the front matter and the body", () => {
    const skill = parseSkill("browse", path, "---\nname: browse\ndescription: A test skill.\n---\n\nBody text.\n")
    expect(skill).toMatchObject({ name: "browse", description: "A test skill.", content: "Body text." })
  })

  test("refuses a missing name, a wrong name and a missing description", () => {
    expect(() => parseSkill("browse", path, "no frontmatter")).toThrow("SKILLS_INVALID")
    expect(() => parseSkill("browse", path, "---\nname: other\ndescription: x\n---\n")).toThrow('must be named "browse"')
    expect(() => parseSkill("browse", path, "---\nname: browse\n---\n")).toThrow("no description")
  })
})

describe("a missing skill file", () => {
  test("is a problem, not a thrown plugin", async () => {
    const empty = mkdtempSync(join(tmpdir(), "browse-skills-empty-"))
    try {
      const { skills, problems } = await loadSkills(empty)
      expect(skills).toEqual([])
      expect(problems).toHaveLength(SKILL_NAMES.length)
      for (const problem of problems) expect(problem.startsWith("SKILLS_INVALID: ")).toBe(true)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
