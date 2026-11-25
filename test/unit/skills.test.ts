// The shipped skills are read from every directory under the package's `skills/` folder and registered through
// `ctx.skill.transform`; a missing or broken file is a status problem, never a plugin that fails to load.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { loadSkills, parseSkill } from "../../src/skills.js"

const root = mkdtempSync(join(tmpdir(), "browse-skills-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const shippedDir = fileURLToPath(new URL("../../skills", import.meta.url))
const shipped = () => readdirSync(shippedDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()

describe("the shipped skills", () => {
  test("are every directory under skills/, with a name and a description", async () => {
    const { skills, problems } = await loadSkills()
    expect(problems).toEqual([])
    expect(skills.map((skill) => String(skill.name))).toEqual(shipped())
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

  test("refuses a missing name, a wrong name, a missing description and an empty body", () => {
    expect(() => parseSkill("browse", path, "no frontmatter")).toThrow("SKILLS_INVALID")
    expect(() => parseSkill("browse", path, "---\nname: other\ndescription: x\n---\n")).toThrow('must be named "browse"')
    expect(() => parseSkill("browse", path, "---\nname: browse\n---\n")).toThrow("no description")
    expect(() => parseSkill("browse", path, "---\nname: browse\ndescription: x\n---\n\n   \n")).toThrow("empty body")
  })

  test("refuses an empty or YAML block scalar description, which would reach the host as > or |", () => {
    expect(() => parseSkill("browse", path, "---\nname: browse\ndescription:\n---\n\nBody.\n")).toThrow("no description")
    for (const description of [">", "|", "> folded text", "| folded text"]) {
      expect(() => parseSkill("browse", path, `---\nname: browse\ndescription: ${description}\n---\n\nBody.\n`)).toThrow("block scalar")
    }
  })
})

describe("loading a directory", () => {
  test("a broken skill is skipped while the others load, and the problem names it", async () => {
    const directory = join(root, "mixed")
    for (const name of ["good", "empty"]) mkdirSync(join(directory, name), { recursive: true })
    writeFileSync(join(directory, "good", "SKILL.md"), "---\nname: good\ndescription: A good skill.\n---\n\nUse it.\n")
    writeFileSync(join(directory, "empty", "SKILL.md"), "---\nname: empty\ndescription: An empty skill.\n---\n\n")
    const { skills, problems } = await loadSkills(directory)
    expect(skills.map((skill) => String(skill.name))).toEqual(["good"])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("SKILLS_INVALID:")
    expect(problems[0]).toContain("empty")
    expect(problems[0]).toContain("empty body")
  })

  test("a directory without SKILL.md is a problem, and other directories still load", async () => {
    const directory = join(root, "missing-file")
    mkdirSync(join(directory, "present"), { recursive: true })
    mkdirSync(join(directory, "absent"), { recursive: true })
    writeFileSync(join(directory, "present", "SKILL.md"), "---\nname: present\ndescription: A present skill.\n---\n\nBody.\n")
    const { skills, problems } = await loadSkills(directory)
    expect(skills.map((skill) => String(skill.name))).toEqual(["present"])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("absent")
    expect(problems[0]).toContain("is missing")
  })

  test("a missing skills folder is one problem, not a thrown plugin", async () => {
    const { skills, problems } = await loadSkills(join(root, "nowhere"))
    expect(skills).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("skills folder cannot be read")
  })
})
