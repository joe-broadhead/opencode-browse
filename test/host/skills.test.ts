// The skills on the real embedded OpenCode 2.4.1 host: the built bundle registers every directory under `skills/`
// through `ctx.skill.transform`, with its description and content, and a malformed (empty-body) skill is skipped and
// reported instead of failing setup. The expected ids come from the directories at test time, never a fixed list.
//
// HOME, the XDG variables and TMPDIR point at an isolated root before anything under `@opencode/*` is imported; the
// package copy lives under this repository so the bundle resolves the host modules from `node_modules` upward.
import "./isolate.js"
import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const bundle = join(repo, "dist", "index.js")
if (!existsSync(bundle)) execFileSync(process.execPath, [join(repo, "scripts", "build.mjs")], { cwd: repo, stdio: "ignore" })

const root = mkdtempSync(join(repo, "test", ".skills-host-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Every skill directory under the shipped `skills/`, sorted. */
const shippedNames = (): string[] =>
  readdirSync(join(repo, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()

/** A shipped skill's frontmatter description and body, read independently of the plugin's parser. */
function shippedSkill(name: string): { description: string; content: string } {
  const text = readFileSync(join(repo, "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n")
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) throw new Error(`${name} has no frontmatter`)
  const description = /^description:\s*(.+)$/m.exec(match[1]!)?.[1]?.trim()
  if (!description) throw new Error(`${name} has no description`)
  return { description, content: match[2]!.trim() }
}

/** A copy of the package as installed: the built bundle, package.json and every skill, one of them broken if named. */
function packageCopy(name: string, broken?: string): string {
  const directory = join(root, name)
  mkdirSync(join(directory, "dist"), { recursive: true })
  cpSync(bundle, join(directory, "dist", "index.js"))
  cpSync(join(repo, "package.json"), join(directory, "package.json"))
  for (const skill of shippedNames()) {
    const to = join(directory, "skills", skill, "SKILL.md")
    mkdirSync(dirname(to), { recursive: true })
    if (skill === broken) writeFileSync(to, `---\nname: ${skill}\ndescription: A broken skill.\n---\n\n`)
    else cpSync(join(repo, "skills", skill, "SKILL.md"), to)
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
    const skills = (await host.skill.list({ location: { directory } })) as { data: { id: string; description?: string; content?: string }[] }
    return { host, sessionID: session.id, skills: skills.data }
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
  test("the built plugin registers every skills/*/SKILL.md id, with its description and content", async () => {
    const expected = shippedNames()
    const packageRoot = packageCopy("package")
    const { host, skills } = await skillsOf(join(packageRoot, "dist", "index.js"), project("project"))
    try {
      const found = skills.filter((skill) => expected.includes(skill.id)).sort((left, right) => left.id.localeCompare(right.id))
      expect(found.map((skill) => skill.id)).toEqual(expected)
      for (const skill of found) {
        const shipped = shippedSkill(skill.id)
        expect({ id: skill.id, description: skill.description }).toEqual({ id: skill.id, description: shipped.description })
        expect({ id: skill.id, content: skill.content }).toEqual({ id: skill.id, content: shipped.content })
      }
    } finally {
      await host.close()
    }
  }, 120_000)

  test("an empty-body skill is skipped, the others load, and the report records the problem", async () => {
    const expected = shippedNames()
    const broken = expected[expected.length - 1]!
    const brokenPackage = packageCopy("broken-package", broken)
    const { host, sessionID, skills } = await skillsOf(join(brokenPackage, "dist", "index.js"), project("broken-project"))
    try {
      const ids = skills.map((skill) => skill.id)
      expect(ids).not.toContain(broken)
      for (const name of expected.filter((name) => name !== broken)) expect(ids).toContain(name)
      const answer = (await host.rpc.call({
        rpcID: "browse",
        method: "report",
        input: { sessionID, input: {} },
        location: { directory: join(root, "broken-project") },
      })) as { output?: { problems?: string[]; state?: string } }
      const problems = answer.output?.problems ?? []
      expect(problems.some((problem) => problem.includes("SKILLS_INVALID") && problem.includes(broken) && problem.includes("empty body"))).toBe(true)
      const status = (await host.rpc.call({
        rpcID: "browse",
        method: "status",
        input: { sessionID, input: {} },
        location: { directory: join(root, "broken-project") },
      })) as { output?: { state?: string } }
      expect(status.output?.state).toBe("error")
    } finally {
      await host.close()
    }
  }, 120_000)
})
