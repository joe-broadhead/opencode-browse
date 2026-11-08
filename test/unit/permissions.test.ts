import { describe, expect, test } from "bun:test"
import { ACCESS_VALUES, DEFAULT_UNKNOWN, TOOLS } from "../../src/browse-tools.js"
import { accessCounts } from "../../src/status.js"
import { defaultRules, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"

const base = (effect: "allow" | "ask" | "deny" = "allow"): Rule => ({ action: "*", resource: "*", effect })
const action = (name: string) => `browse_${name}`
const findRule = (rules: Rule[], name: string) => rules.findLast((rule) => rule.action === action(name))
const set = (access: "all" | "ask-changes" | "read-only") => ({ access, scoped: false, readOnly: false })

describe("the default rules", () => {
  test("allow the namespace by default, so a tool browse adds later runs at once", () => {
    const rules = defaultRules()
    expect(rules[0]).toEqual({ action: "browse_*", resource: "*", effect: "allow" })
    expect(rules.filter((rule) => rule.action.endsWith("*")).map((rule) => rule.action)).toEqual(["browse_*"])
    expect(rules).toHaveLength(1 + TOOLS.length)
    expect(DEFAULT_UNKNOWN).toBe("allow")
    expect(evaluate(rules, action("shiny_new_tool"))).toBe("allow")
  })

  test("then one rule per known tool, by exact name, allowed by default", () => {
    const rules = defaultRules()
    for (const tool of TOOLS) expect(findRule(rules, tool.name), tool.name).toEqual({ action: action(tool.name), resource: "*", effect: "allow" })
    expect(evaluate(rules, action("execute"))).toBe("allow")
    expect(evaluate(rules, action("network"))).toBe("allow")
    expect(accessCounts(set("all"))).toEqual({ run: 18, ask: 0, off: 0 })
  })

  test("ask-changes asks for every tool that is not a read, and an unknown tool asks too", () => {
    const rules = defaultRules(set("ask-changes"))
    for (const tool of TOOLS) expect(evaluate(rules, action(tool.name))).toBe(tool.class === "read" ? "allow" : "ask")
    expect(evaluate(rules, action("shiny_new_tool"))).toBe("ask")
    expect(accessCounts(set("ask-changes"))).toEqual({ run: 4, ask: 14, off: 0 })
  })

  test("read-only denies every tool that is not a read", () => {
    const rules = defaultRules(set("read-only"))
    for (const tool of TOOLS) expect(evaluate(rules, action(tool.name))).toBe(tool.class === "read" ? "allow" : "deny")
    expect(evaluate(rules, action("shiny_new_tool"))).toBe("deny")
    expect(accessCounts(set("read-only"))).toEqual({ run: 4, ask: 0, off: 14 })
  })

  test("every access value generates a block of the same length", () => {
    for (const access of ACCESS_VALUES) expect(defaultRules(set(access))).toHaveLength(1 + TOOLS.length)
  })

  test("the scoped profile denies the session escape and runs a read-only execute", () => {
    const scoped = defaultRules({ access: "all", scoped: true, readOnly: true })
    expect(evaluate(scoped, action("session_new"))).toBe("deny")
    expect(evaluate(scoped, action("session_allowlist"))).toBe("deny")
    expect(evaluate(scoped, action("execute"))).toBe("allow")
    expect(accessCounts({ access: "all", scoped: true, readOnly: true })).toEqual({ run: 13, ask: 0, off: 5 })
    // A writable pinned session asks for execute, because input is allowed there.
    const writable = defaultRules({ access: "all", scoped: true, readOnly: false })
    expect(evaluate(writable, action("execute"))).toBe("ask")
    expect(accessCounts({ access: "all", scoped: true, readOnly: false })).toEqual({ run: 12, ask: 1, off: 5 })
  })

  test("scoped mode keeps its denies under every access value", () => {
    for (const access of ACCESS_VALUES) {
      const rules = defaultRules({ access, scoped: true, readOnly: false })
      for (const tool of ["session_new", "session_use", "session_adopt", "session_delete", "session_allowlist"]) expect(evaluate(rules, action(tool))).toBe("deny")
    }
  })
})

describe("insertion", () => {
  test("goes directly after the agent's base allow, and only once", () => {
    const permissions: Rule[] = [base()]
    expect(insertRules(permissions, defaultRules())).toBe(true)
    expect(permissions.slice(1, 2 + TOOLS.length)).toEqual(defaultRules())
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
    const permissions: Rule[] = [base(), ...defaultRules(), { action: "browse_execute", resource: "*", effect: "deny" }]
    expect(evaluate(permissions, "browse_execute")).toBe("deny")
  })
})

describe("upgrades between profiles", () => {
  test("adding scope replaces the default block, so the scoped denies decide", () => {
    const permissions: Rule[] = [base()]
    insertRules(permissions, defaultRules())
    insertRules(permissions, defaultRules({ access: "all", scoped: true, readOnly: true }))
    expect(evaluate(permissions, action("session_new"))).toBe("deny")
    expect(evaluate(permissions, action("session_allowlist"))).toBe("deny")
    expect(evaluate(permissions, action("execute"))).toBe("allow")
    // Only one block remains: the scoped one.
    expect(hasDefaultRules(permissions, { access: "all", scoped: true, readOnly: true })).toBe(true)
    expect(hasDefaultRules(permissions, { access: "all", scoped: false, readOnly: false })).toBe(false)
  })

  test("removing scope replaces the scoped block with the default one", () => {
    const permissions: Rule[] = [base()]
    insertRules(permissions, defaultRules({ access: "all", scoped: true, readOnly: true }))
    insertRules(permissions, defaultRules())
    expect(evaluate(permissions, action("session_new"))).toBe("allow")
    expect(evaluate(permissions, action("execute"))).toBe("allow")
    expect(hasDefaultRules(permissions, { access: "all", scoped: false, readOnly: false })).toBe(true)
  })

  test("changing access replaces the block, so the old posture cannot decide", () => {
    const permissions: Rule[] = [base()]
    insertRules(permissions, defaultRules())
    insertRules(permissions, defaultRules(set("read-only")))
    expect(evaluate(permissions, action("execute"))).toBe("deny")
    expect(hasDefaultRules(permissions, { access: "read-only", scoped: false, readOnly: false })).toBe(true)
    expect(hasDefaultRules(permissions, { access: "all", scoped: false, readOnly: false })).toBe(false)
  })
})

describe("agents without the rules", () => {
  test("are the ones with a base allow whose own rules let a new browse tool run", () => {
    const agents = [
      { id: "build", permissions: [base()] },
      { id: "careful", permissions: [base(), { action: "browse_*", resource: "*", effect: "ask" } as Rule] },
      { id: "strict", permissions: [base("deny")] },
      { id: "blocked", permissions: [{ action: "*", resource: "*", effect: "deny" } as Rule] },
    ]
    expect(unguardedAgents(agents)).toEqual(["build"])
  })

  test("registering the rules is idempotent", async () => {
    const agents = [{ id: "build", permissions: [base()] as Rule[] }]
    const transform = async (fn: (editor: { list: () => { id: string }[]; update: (id: string, change: (info: { permissions: Rule[] }) => void) => void }) => void) => {
      fn({ list: () => agents.map((agent) => ({ id: agent.id })), update: (id, change) => change(agents.find((agent) => agent.id === id)!) })
      return { dispose: async () => undefined }
    }
    await registerDefaultRules({ transform } as never, defaultRules(), () => undefined)
    await registerDefaultRules({ transform } as never, defaultRules(), () => undefined)
    expect(agents[0]!.permissions.filter((rule) => rule.action === "browse_*")).toHaveLength(1)
  })
})
