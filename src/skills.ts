import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { Skill, type Plugin } from "@opencode/plugin"
import { errorText, browseError } from "./constants.js"
import { packageRoot } from "./package.js"
import { reasonOf } from "./redact.js"

/** `skills/` at the package root, next to `dist/` (and next to `src/` in the repository). */
export const SKILLS_DIR = join(packageRoot, "skills")

const notLoaded = (name: string, problem: string) => `The "${name}" skill was not loaded: skills/${name}/SKILL.md ${problem}.`
const REINSTALL = "Reinstall the plugin."

/**
 * Parses `---` frontmatter with `name` and `description`; the body after it is the skill's content. OpenCode 2.4.1
 * loads skills a plugin registers through `ctx.skill.transform`; it does not scan a plugin package's `skills/` folder,
 * so the files are read here and registered in setup.
 */
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
  // The front matter is read line by line, so a YAML block scalar would reach the host as ">" or "|" and make the
  // skill invisible to agents. Every shipped description is one line; a block scalar is refused with a next step.
  if (description.startsWith(">") || description.startsWith("|")) throw fail("uses a YAML block scalar; write the description on one line")
  const content = match[2]!.trim()
  if (content === "") throw fail("has an empty body")
  return { id: Skill.ID.make(name), name: Skill.Name.make(name), description, path: Skill.Info.fields.path.make(path), content }
}

/**
 * Reads every directory under `skills/` and its `SKILL.md` before the synchronous transform needs it. A missing or
 * broken file does not stop the plugin, because the server and the access rules still work; it is recorded as a
 * status problem instead. The directory is the source of truth: a skill directory that exists is always looked at.
 */
export async function loadSkills(directory = SKILLS_DIR) {
  const skills: Skill.Info[] = []
  const problems: string[] = []
  let names: string[]
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch (error) {
    const code = (error as { code?: unknown }).code
    return {
      skills,
      problems: [errorText("SKILLS_INVALID", `The plugin's skills folder cannot be read (${code === "ENOENT" ? "it is missing" : typeof code === "string" ? code : reasonOf(error)}).`, REINSTALL)],
    }
  }
  for (const name of names) {
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

/** Adds each skill with the exact `Skill.Info` shape OpenCode 2.4.1's skill editor takes. */
export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform((editor) => {
    for (const info of skills) editor.add({ id: info.id, name: info.name, description: info.description, path: info.path, content: info.content })
  })
}
