import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_UNKNOWN, TOOLS, TOOL_NAMES, classify, defaultEffectOf, effectOf, scopedEffectOf } from "../../src/browse-tools.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const fixture = JSON.parse(readFileSync(join(root, "test", "fixtures", "live-tools.json"), "utf8")) as { tools: { name: string; annotations: Record<string, unknown> }[] }

describe("the tool table", () => {
  test("is the 18 tools browse 0.0.15 lists, in one exact name each", () => {
    expect(TOOL_NAMES).toHaveLength(18)
    expect(new Set(TOOL_NAMES).size).toBe(18)
    expect([...fixture.tools.map((tool) => tool.name)].sort()).toEqual([...TOOL_NAMES].sort())
  })

  test("carries every annotation the server sends", () => {
    for (const tool of TOOLS) {
      const live = fixture.tools.find((entry) => entry.name === tool.name)
      expect(live, tool.name).toBeDefined()
      expect({ readOnlyHint: tool.readOnly, destructiveHint: tool.destructive, idempotentHint: tool.idempotent, openWorldHint: tool.openWorld }, tool.name).toEqual({
        readOnlyHint: live!.annotations.readOnlyHint as boolean,
        destructiveHint: live!.annotations.destructiveHint as boolean,
        idempotentHint: live!.annotations.idempotentHint as boolean,
        openWorldHint: live!.annotations.openWorldHint as boolean,
      })
    }
  })

  test("the default table: 18 run, none ask, none off", () => {
    const counts = TOOLS.reduce((all, tool) => ({ ...all, [tool.effect]: all[tool.effect] + 1 }), { allow: 0, ask: 0, deny: 0 })
    expect(counts).toEqual({ allow: 18, ask: 0, deny: 0 })
    for (const name of ["network", "recording", "flight_recorder", "secrets_run", "execute"]) expect(effectOf(name)).toBe("allow")
  })

  test("an unknown name runs by default, and the scoped profile is stricter", () => {
    expect(effectOf("shiny_new_tool")).toBe(DEFAULT_UNKNOWN)
    expect(DEFAULT_UNKNOWN).toBe("allow")
    expect(defaultEffectOf("shiny_new_tool", "all")).toBe("allow")
    expect(defaultEffectOf("shiny_new_tool", "ask-changes")).toBe("ask")
    expect(defaultEffectOf("shiny_new_tool", "read-only")).toBe("deny")
    expect(defaultEffectOf("status", "read-only")).toBe("allow")
    expect(classify("shiny_new_tool")).toBe("unknown")
    for (const name of ["session_new", "session_use", "session_adopt", "session_delete", "session_allowlist"]) expect(scopedEffectOf(name, false)).toBe("deny")
    expect(scopedEffectOf("execute", false)).toBe("ask")
    expect(scopedEffectOf("execute", true)).toBe("allow")
    expect(scopedEffectOf("status", true)).toBe("allow")
  })

  test("classes are the worst case, and a read is never destructive", () => {
    for (const tool of TOOLS) {
      if (tool.class === "read") expect({ name: tool.name, readOnly: tool.readOnly, destructive: tool.destructive }).toEqual({ name: tool.name, readOnly: true, destructive: false })
    }
    expect(classify("network")).toBe("export")
    expect(classify("recording")).toBe("export")
    expect(classify("flight_recorder")).toBe("export")
    expect(classify("execute")).toBe("destructive")
    expect(classify("settings")).toBe("write")
  })
})
