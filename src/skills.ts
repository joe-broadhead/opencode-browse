import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"
import { errorText, browseError } from "./constants.js"
import { reasonOf } from "./redact.js"

/** `skills/` at the package root, next to `dist/` (and next to `src/` in the repository). */
export const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url))

/** The skills the plugin ships: the main one and the one for captures. */
export const SKILL_NAMES: readonly string[] = ["browse", "browse-capture"]

const notLoaded = (name: string, problem: string) => `The "${name}" skill was not loaded: skills/${name}/SKILL.md ${problem}.`
const REINSTALL = "Reinstall the plugin."

/** Parses `---` frontmatter with `name` and `description`; the body after it is the skill's content. */
export function parseSkill(name: string, path: string, text: string): Skill.Info {
  const fail = (problem: string) => browseError("SKILLS_INVALID", notLoaded(name, problem), REINSTALL)
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (!match) throw fail("has no frontmatter")
  const fields = new Map(
    match[1]!.split("\n").map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim().replace(/^(["'])(.*)\1$/, "$2")]),
  )
  if (fields.get("name") !== name) throw fail(`must be named "${name}" in its frontmatter`)
  const description = fields.get("description")
  if (!description) throw fail("has no description")
  return { id: Skill.ID.make(name), name: Skill.Name.make(name), description, path: Skill.Info.fields.path.make(path), content: match[2]!.trim() }
}

/**
 * Reads the skills before the synchronous transform needs them. A missing or broken skill file does not stop the
 * plugin, because the server and the permission rules still work; it is reported as a problem in status instead.
 */
export async function loadSkills(directory = SKILLS_DIR) {
  const skills: Skill.Info[] = []
  const problems: string[] = []
  for (const name of SKILL_NAMES) {
    const path = join(directory, name, "SKILL.md")
    try {
      skills.push(parseSkill(name, path, await readFile(path, "utf8")))
    } catch (error) {
      const code = (error as { code?: unknown }).code
      problems.push(code === "SKILLS_INVALID" ? (error as Error).message : errorText("SKILLS_INVALID", notLoaded(name, code === "ENOENT" ? "is missing" : `cannot be read (${typeof code === "string" ? code : reasonOf(error)})`), REINSTALL))
    }
  }
  return { skills, problems }
}

export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform((editor) => {
    for (const info of skills) editor.add(info)
  })
}
