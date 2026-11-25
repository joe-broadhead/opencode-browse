// The skills on the real embedded OpenCode 2.4.1 host: the built bundle reads every directory under `skills/`, parses
// each SKILL.md frontmatter as YAML and registers its text through `ctx.skill.transform`, so a folded or literal
// description arrives as its text, never as the `>` or `|` marker. The expected ids come from the directories at test
// time, never a fixed list.
//
// HOME, the XDG variables and TMPDIR point at an isolated root before anything under `@opencode/*` is imported; the
// package copy lives under this repository so the bundle resolves the host modules from `node_modules` upward.
import "./isolate.js"
import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parse } from "yaml"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const bundle = join(repo, "dist", "index.js")
if (!existsSync(bundle)) execFileSync(process.execPath, [join(repo, "scripts", "build.mjs")], { cwd: repo, stdio: "ignore" })

const root = mkdtempSync(join(repo, "test", ".skills-host-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Every skill directory under the shipped `skills/`, sorted. */
const shippedNames = (): string[] =>
  readdirSync(join(repo, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()

/** A SKILL.md's YAML description and body, read with a real YAML parser (not a first-line reader). */
function frontmatter(text: string): { description: string; content: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (!match) throw new Error("the skill has no frontmatter")
  const front = parse(match[1]!) as { description?: unknown }
  if (typeof front.description !== "string") throw new Error("the skill has no YAML description")
  return { description: front.description, content: match[2]!.trim() }
}

/** A copy of the package as installed: the built bundle, package.json and every shipped skill. */
function packageCopy(name: string): string {
  const directory = join(root, name)
  mkdirSync(join(directory, "dist"), { recursive: true })
  cpSync(bundle, join(directory, "dist", "index.js"))
  cpSync(join(repo, "package.json"), join(directory, "package.json"))
  for (const skill of shippedNames()) {
    const to = join(directory, "skills", skill, "SKILL.md")
    mkdirSync(dirname(to), { recursive: true })
    cpSync(join(repo, "skills", skill, "SKILL.md"), to)
  }
  return directory
}

/** A package copy with four extra skills whose descriptions are YAML block scalars. */
function packageCopyWithBlockScalars(name: string, variants: readonly { readonly id: string; readonly marker: string }[]): string {
  const directory = packageCopy(name)
  for (const variant of variants) {
    const to = join(directory, "skills", variant.id, "SKILL.md")
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, `---\nname: ${variant.id}\ndescription: ${variant.marker}\n  first line\n  second line\n---\n\n# ${variant.id}\n`)
  }
  return directory
}

/** One real host with the plugin at `entry`, and what its skill editor holds after activation. */
async function skillsOf(entry: string, directory: string) {
  const { OpenCode } = await import("@opencode/sdk")
  const plugin = (await import(`${pathToFileURL(entry).href}?v=${encodeURIComponent(entry)}`)).default
  const host = await OpenCode.create({
    app: { name: "opencode", version: "2.4.1" },
    plugins: [plugin],
    database: { path: join(root, `opencode-${Math.random().toString(16).slice(2)}.db`) },
    models: { fetch: false },
    fs: { filewatcher: false },
    config: { directory },
    log: { level: "error", emit: () => undefined },
  })
  try {
    const session = await host.sessions.create({ location: { directory }, agent: "build" })
    await host.sessions.prompt({ sessionID: session.id, text: "activate the browse plugin", delivery: "queue" }).catch(() => undefined)
    const until = Date.now() + 20_000
    for (;;) {
      const active = await host.plugin
        .list({ location: { directory } })
        .then(
          (list: { data: { id?: string; state?: { status?: string } }[] }) => list.data.some((item) => item.id === "browse" && item.state?.status === "active"),
          () => false,
        )
      if (active || Date.now() > until) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const skills = (await host.skill.list({ location: { directory } })) as { data: { id: string; name: string; description?: string; path: string; content: string }[] }
    return { host, skills: skills.data }
  } catch (error) {
    await host.close().catch(() => undefined)
    throw error
  }
}

const project = (name: string) => {
  const directory = join(root, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "opencode.json"), "{}")
  return directory
}

describe("the skills on the real host", () => {
  test("every skills/*/SKILL.md registers with its YAML description, name, path and content", async () => {
    const expected = shippedNames()
    const packageRoot = packageCopy("package")
    const { host, skills } = await skillsOf(join(packageRoot, "dist", "index.js"), project("project"))
    try {
      const found = skills.filter((skill) => expected.includes(skill.id)).sort((left, right) => left.id.localeCompare(right.id))
      expect(found.map((skill) => skill.id)).toEqual(expected)
      for (const skill of found) {
        const path = join(packageRoot, "skills", skill.id, "SKILL.md")
        const shipped = frontmatter(readFileSync(path, "utf8"))
        expect({ id: skill.id, name: skill.name }).toEqual({ id: skill.id, name: skill.id })
        expect({ id: skill.id, path: skill.path }).toEqual({ id: skill.id, path })
        expect({ id: skill.id, content: skill.content }).toEqual({ id: skill.id, content: shipped.content })
        expect({ id: skill.id, description: skill.description }).toEqual({ id: skill.id, description: shipped.description })
        expect(shipped.description.trim()).not.toBe("")
        for (const marker of [">", "|", ">-", "|-", ">+", "|+"]) expect(shipped.description.trim()).not.toBe(marker)
      }
    } finally {
      await host.close()
    }
  }, 120_000)

  test("a folded or literal description registers its text, never the block marker", async () => {
    const variants = [
      { id: "folded", marker: ">", expected: "first line second line\n" },
      { id: "literal", marker: "|", expected: "first line\nsecond line\n" },
      { id: "folded-strip", marker: ">-", expected: "first line second line" },
      { id: "literal-strip", marker: "|-", expected: "first line\nsecond line" },
    ] as const
    const packageRoot = packageCopyWithBlockScalars("block-scalar-package", variants)
    const { host, skills } = await skillsOf(join(packageRoot, "dist", "index.js"), project("block-scalar-project"))
    try {
      for (const variant of variants) {
        const skill = skills.find((candidate) => candidate.id === variant.id)
        expect({ id: variant.id, registered: skill !== undefined }).toEqual({ id: variant.id, registered: true })
        expect({ id: variant.id, description: skill?.description }).toEqual({ id: variant.id, description: variant.expected })
        expect(skill?.description).not.toBe(variant.marker)
      }
      for (const id of shippedNames()) expect(skills.some((skill) => skill.id === id)).toBe(true)
    } finally {
      await host.close()
    }
  }, 120_000)
})
