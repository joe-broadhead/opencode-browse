// The shipped skills are read from every directory under the package's `skills/` folder; their frontmatter is parsed
// as YAML, so a folded or literal description registers as its text, never as the `>` or `|` marker.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin"
import { parse as parseYaml } from "yaml"
import { readSkills, registerSkills } from "../../src/skills.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const temporary: string[] = []
afterAll(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true })
})

/** A temporary `skills/` directory holding one <name>/SKILL.md per entry. */
function fixture(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "browse-skills-"))
  temporary.push(directory)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name), { recursive: true })
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

const shipped = (): string[] =>
  readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

describe("the shipped skills", () => {
  test("are every directory, with its YAML frontmatter name, description and body", () => {
    const skills = readSkills()
    expect(skills.map((skill) => skill.id)).toEqual(shipped())
    for (const skill of skills) {
      expect(skill.name).toBe(skill.id)
      expect(skill.path).toBe(join(root, "skills", skill.id, "SKILL.md"))
      expect(skill.content.length).toBeGreaterThan(0)
      expect(skill.content.includes("---")).toBe(false)
      const text = readFileSync(skill.path, "utf8")
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
      expect(frontmatter).not.toBeNull()
      const parsed = parseYaml(frontmatter![1] ?? "") as { description?: unknown }
      expect(typeof parsed.description).toBe("string")
      const expected = parsed.description as string
      expect(expected.trim()).not.toBe("")
      for (const marker of [">", "|", ">-", "|-", ">+", "|+"]) expect(expected.trim()).not.toBe(marker)
      expect(skill.description).toBe(expected)
    }
  })
})

describe("YAML descriptions", () => {
  const cases: readonly [string, string, string][] = [
    ["folded", ">", "first line second line\n"],
    ["literal", "|", "first line\nsecond line\n"],
    ["folded-strip", ">-", "first line second line"],
    ["literal-strip", "|-", "first line\nsecond line"],
  ]

  test("block scalars are folded, literal or stripped as YAML specifies", () => {
    for (const [name, marker, expected] of cases) {
      const directory = fixture({ [name]: `---\nname: ${name}\ndescription: ${marker}\n  first line\n  second line\n---\n\n# Body\n` })
      expect({ name, description: readSkills(directory)[0]?.description }).toEqual({ name, description: expected })
    }
  })

  test("an empty block scalar is empty, and a quoted marker is only a marker", () => {
    expect(() => readSkills(fixture({ empty: "---\nname: empty\ndescription: >\n---\n\n# Body\n" }))).toThrow("has no frontmatter description")
    expect(() => readSkills(fixture({ marker: "---\nname: marker\ndescription: '>'\n---\n\n# Body\n" }))).toThrow("only a block marker")
  })

  test("a plain description containing ': ' is invalid YAML unless quoted", () => {
    expect(() => readSkills(fixture({ unquoted: "---\nname: unquoted\ndescription: Record a session with browse: screen\n---\n\n# Body\n" }))).toThrow(
      "has frontmatter that is not valid YAML",
    )
    const quoted = readSkills(fixture({ quoted: '---\nname: quoted\ndescription: "Record a session with browse: screen"\n---\n\n# Body\n' }))
    expect(quoted[0]?.description).toBe("Record a session with browse: screen")
  })
})

describe("the skill file shape", () => {
  test("a missing frontmatter, name, description or body is a SCHEMA_VIOLATION", () => {
    const cases: readonly [string, Readonly<Record<string, string>>, RegExp][] = [
      ["no frontmatter", { broken: "# Broken\n" }, /SCHEMA_VIOLATION: skills\/broken\/SKILL\.md has no frontmatter\. Next step: /],
      ["no name", { broken: "---\ndescription: A description.\n---\n\n# Body\n" }, /has no frontmatter name/],
      ["another name", { broken: "---\nname: other\ndescription: A description.\n---\n\n# Body\n" }, /names "other", not its directory "broken"/],
      ["no description", { broken: "---\nname: broken\n---\n\n# Body\n" }, /has no frontmatter description/],
      ["empty content", { broken: "---\nname: broken\ndescription: A description.\n---\n\n" }, /has no content below its frontmatter/],
      ["invalid YAML", { broken: "---\nname: broken\ndescription: [unclosed\n---\n\n# Body\n" }, /has frontmatter that is not valid YAML/],
    ]
    for (const [name, files, expected] of cases) {
      let message = "no error"
      try {
        readSkills(fixture(files))
      } catch (error) {
        message = (error as Error).message
      }
      expect({ name, message }).toEqual({ name, message: expect.stringMatching(expected) })
    }
  })

  test("a missing file, a missing directory and a folder with no skills are errors", () => {
    const missing = mkdtempSync(join(tmpdir(), "browse-skills-"))
    temporary.push(missing)
    mkdirSync(join(missing, "empty"), { recursive: true })
    expect(() => readSkills(missing)).toThrow("skills/empty/SKILL.md is missing")

    const none = mkdtempSync(join(tmpdir(), "browse-skills-"))
    temporary.push(none)
    expect(() => readSkills(none)).toThrow("skills/ holds no <name>/SKILL.md")
  })
})

describe("registerSkills", () => {
  test("registers the YAML text of every block scalar and returns a disposer", async () => {
    const cases: readonly [string, string, string][] = [
      ["folded", ">", "first line second line\n"],
      ["literal", "|", "first line\nsecond line\n"],
      ["folded-strip", ">-", "first line second line"],
      ["literal-strip", "|-", "first line\nsecond line"],
    ]
    const directory = fixture(Object.fromEntries(cases.map(([name, marker]) => [name, `---\nname: ${name}\ndescription: ${marker}\n  first line\n  second line\n---\n\n# Body\n`])))
    const added: { id: string; name: string; description?: string; path: string; content: string }[] = []
    let disposed = false
    const context = {
      skill: {
        async transform(callback: (editor: { add: (skill: (typeof added)[number]) => void }) => void) {
          callback({ add: (skill) => added.push(skill) })
          return { async dispose() { disposed = true } }
        },
      },
    } as unknown as Plugin.Context

    const registration = await registerSkills(context, readSkills(directory))
    const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)
    expect(added.map(({ id, name, description }) => ({ id, name, description })).sort(byId)).toEqual(
      cases.map(([id, , description]) => ({ id, name: id, description })).sort(byId),
    )
    for (const skill of added) {
      expect(skill.path).toBe(join(directory, skill.id, "SKILL.md"))
      expect(skill.content).toBe("# Body")
    }
    await registration.dispose()
    expect(disposed).toBe(true)
  })
})
