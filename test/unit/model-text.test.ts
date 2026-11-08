import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { NAMESPACE_DESCRIPTION } from "../../src/constants.js"
import { defaultEffectOf, TOOLS } from "../../src/browse-tools.js"

// Item 16: every string the model sees states what happens under the default, `access: "all"`. A tool that runs may not
// be described as asking, or as off until something classifies it: the model then hedges, or skips the tool.
const root = fileURLToPath(new URL("../..", import.meta.url))
const read = (path: string) => readFileSync(join(root, path), "utf8")
const SKILLS = ["skills/browse/SKILL.md", "skills/browse-capture/SKILL.md"]
// The model reads the namespace description, both skills, the README's Use and Permissions sections, SECURITY's
// Permissions section, and the scripting guide.
const MODEL_TEXT: { name: string; text: string }[] = [
  { name: "src/constants.ts NAMESPACE_DESCRIPTION", text: NAMESPACE_DESCRIPTION },
  ...SKILLS.map((path) => ({ name: path, text: read(path) })),
  { name: "README.md", text: read("README.md") },
  { name: "SECURITY.md", text: read("SECURITY.md") },
  { name: "docs/scripting.md", text: read("docs/scripting.md") },
]

describe("the model-facing text", () => {
  test("describes every tool that runs under the default as running, never as asking or off", () => {
    const allowing = TOOLS.filter((tool) => defaultEffectOf(tool.name, "all") === "allow")
    expect(allowing).toHaveLength(TOOLS.length)
    for (const tool of allowing) {
      const claims = new RegExp(`\\b${tool.name}\`?\\s+(?:always\\s+)?asks\\b`, "i")
      for (const document of MODEL_TEXT) expect({ tool: tool.name, text: claims.test(document.text), doc: document.name }).toEqual({ tool: tool.name, text: false, doc: document.name })
    }
  })

  test("carries no stale default from before the allow-by-default rule", () => {
    const stale = [
      "8 run, 10 ask",
      "off until this plugin classifies",
      "off until classified",
      "`execute` asks on every call",
      "It asks before speaking",
      "a tool browse adds later denied",
    ]
    for (const document of MODEL_TEXT) for (const phrase of stale) expect({ doc: document.name, phrase, found: document.text.includes(phrase) }).toEqual({ doc: document.name, phrase, found: false })
  })

  // The two traps the live evaluation found, told wherever the model meets the tools.
  test("names the access values and the Code Mode call shape", () => {
    expect(NAMESPACE_DESCRIPTION).toContain('await tools.browse.execute({ code: "…" })')
    expect(NAMESPACE_DESCRIPTION).toContain("session_new")
    expect(NAMESPACE_DESCRIPTION).toContain('access: "ask-changes"')
    expect(NAMESPACE_DESCRIPTION).toContain('access: "read-only"')
    expect(read("skills/browse/SKILL.md")).toContain('await tools.browse.execute({ code: "return page.url()" })')
  })
})
