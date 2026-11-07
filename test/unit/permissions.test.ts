import { describe, expect, test } from "bun:test"
import { TOOLS } from "../../src/browse-tools.js"
import { accessCounts } from "../../src/status.js"
import { defaultRules, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"

const base = (effect: "allow" | "ask" | "deny" = "allow"): Rule => ({ action: "*", resource: "*", effect })
const action = (name: string) => `browse_${name}`
const findRule = (rules: Rule[], name: string) => rules.findLast((rule) => rule.action === action(name))

describe("the default rules", () => {
  test("start with a deny for every name, so a tool browse adds later is off", () => {
    const rules = defaultRules()
    expect(rules[0]).toEqual({ action: "opencode_browser_*", resource: "*", effect: "deny" })
    expect(rules[1]).toEqual({ action: "browse_*", resource: "*", effect: "deny" })
    expect(rules.filter((rule) => rule.action.endsWith("*")).map((rule) => rule.action)).toEqual(["opencode_browser_*", "browse_*"])
    expect(rules).toHaveLength(20)
  })

  test("then one rule per known tool, by exact name, with the owner's effect", () => {
    const rules = defaultRules()
    for (const tool of TOOLS) expect(findRule(rules, tool.name), tool.name).toEqual({ action: action(tool.name), resource: "*", effect: tool.effect })
    expect(evaluate(rules, action("shiny_new_tool"))).toBe("deny")
    expect(evaluate(rules, action("execute"))).toBe("ask")
    expect(evaluate(rules, action("network"))).toBe("allow")
    expect(accessCounts({ scoped: false, readOnly: false })).toEqual({ run: 8, ask: 10, off: 0 })
  })

  test("the scoped profile denies the session escape and runs a read-only execute", () => {
    const scoped = defaultRules({ scoped: true, readOnly: true })
    expect(evaluate(scoped, action("session_new"))).toBe("deny")
    expect(evaluate(scoped, action("session_allowlist"))).toBe("deny")
    expect(evaluate(scoped, action("execute"))).toBe("allow")
    expect(evaluate(scoped, action("session_reset"))).toBe("ask")
    expect(accessCounts({ scoped: true, readOnly: true })).toEqual({ run: 9, ask: 4, off: 5 })
    const writable = defaultRules({ scoped: true, readOnly: false })
    expect(evaluate(writable, action("execute"))).toBe("ask")
    expect(accessCounts({ scoped: true, readOnly: false })).toEqual({ run: 8, ask: 5, off: 5 })
  })
})

describe("insertion", () => {
  test("goes directly after the agent's base allow, and only once", () => {
    const permissions: Rule[] = [base()]
    expect(insertRules(permissions, defaultRules())).toBe(true)
    expect(permissions.slice(1, 21)).toEqual(defaultRules())
    expect(insertRules(permissions, defaultRules())).toBe(false)
  })

  test("an agent without a base allow gets nothing, so a default deny is never loosened", () => {
    const permissions: Rule[] = [base("deny")]
    expect(insertRules(permissions, defaultRules())).toBe(false)
    expect(permissions).toEqual([base("deny")])
  })

  test("the block is recognised anywhere after the base allow, beside another plugin's block", () => {
    const other: Rule = { action: "x_*", resource: "*", effect: "ask" }
    const permissions: Rule[] = [base(), other, ...defaultRules()]
    expect(hasDefaultRules(permissions)).toBe(true)
    expect(permissions.findIndex((rule) => rule === other)).toBe(1)
  })

  test("a later user rule still wins", () => {
    const permissions: Rule[] = [base(), ...defaultRules(), { action: "browse_execute", resource: "*", effect: "allow" }]
    expect(evaluate(permissions, "browse_execute")).toBe("allow")
  })
})

describe("upgrades between profiles", () => {
  test("adding scope replaces the default block, so the scoped denies decide", () => {
    const permissions: Rule[] = [base()]
    insertRules(permissions, defaultRules())
    insertRules(permissions, defaultRules({ scoped: true, readOnly: true }))
    expect(evaluate(permissions, action("session_new"))).toBe("deny")
    expect(evaluate(permissions, action("session_allowlist"))).toBe("deny")
    expect(evaluate(permissions, action("execute"))).toBe("allow")
    // Only one block remains: the scoped one.
    expect(hasDefaultRules(permissions, { scoped: true, readOnly: true })).toBe(true)
    expect(hasDefaultRules(permissions, { scoped: false, readOnly: false })).toBe(false)
  })

  test("removing scope replaces the scoped block with the default one", () => {
    const permissions: Rule[] = [base()]
    insertRules(permissions, defaultRules({ scoped: true, readOnly: true }))
    insertRules(permissions, defaultRules())
    expect(evaluate(permissions, action("session_new"))).toBe("ask")
    expect(evaluate(permissions, action("execute"))).toBe("ask")
    expect(hasDefaultRules(permissions, { scoped: false, readOnly: false })).toBe(true)
  })

  test("the legacy server's tools are denied by exact-name pattern", () => {
    const rules = defaultRules()
    expect(evaluate(rules, "opencode_browser_execute")).toBe("deny")
    expect(evaluate(rules, "opencode_browser_network")).toBe("deny")
    expect(evaluate(rules, "opencode_browser_status")).toBe("deny")
  })
})

describe("agents without the rules", () => {
  test("are the ones with a base allow whose own rules let a new browse tool run", () => {
    const agents = [
      { id: "build", permissions: [base()] },
      { id: "guarded", permissions: [base(), ...defaultRules()] },
      { id: "closed", permissions: [base("deny")] },
      { id: "asks", permissions: [base(), { action: "browse_*", resource: "*", effect: "ask" } as Rule] },
    ]
    expect(unguardedAgents(agents)).toEqual(["build"])
  })
})

describe("registration", () => {
  test("never throws; a failure becomes the status problem", async () => {
    const problems: (string | undefined)[] = []
    const transform = (callback: (editor: { list: () => { id: string }[]; update: (id: string, update: (info: { permissions: Rule[] }) => void) => void }) => void) => {
      callback({ list: () => { throw new Error("boom") }, update: () => undefined })
      return Promise.resolve({ dispose: async () => undefined })
    }
    await registerDefaultRules({ transform } as never, defaultRules(), (problem) => problems.push(problem))
    expect(problems[0]).toStartWith("RULES_NOT_ADDED: Browse's default permission rules could not be added")
    expect(problems[0]).toContain("Next step: Restart OpenCode.")
  })
})
