// The scope option's narrowing: the contract's access module owns the rules, and a pinned session only turns the tools
// that could leave it off (and makes `execute` ask unless the session refuses input). The block goes after the
// contract's rules so it narrows them, and never widens anything.
import { describe, expect, test } from "bun:test"
import { rulesFor, type PermissionRule } from "@we-the-rebel-alliance/plugin-contract/access"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { manifest } from "../../src/manifest.js"
import { insertScopeRules, removeScopeRules, scopeRules } from "../../src/scope.js"

const base = (): PermissionRule[] => [{ action: "*", resource: "*", effect: "allow" }, ...rulesFor(manifest as Manifest, "all")]


describe("the scoped profile", () => {
  test("denies the five session tools that could leave the pinned session", () => {
    const rules = scopeRules({ session: "opencode", allowedOrigins: [], readOnly: false })
    for (const tool of ["session_new", "session_use", "session_adopt", "session_delete", "session_allowlist"]) {
      expect(rules).toContainEqual({ action: `browse_${tool}`, resource: "*", effect: "deny" })
    }
    expect(rules).toContainEqual({ action: "browse_execute", resource: "*", effect: "ask" })
  })

  test("lets execute run on a read-only session, whose input the relay refuses", () => {
    const rules = scopeRules({ session: "opencode", allowedOrigins: [], readOnly: true })
    expect(rules.some((rule) => rule.action === "browse_execute")).toBe(false)
  })

  test("never emits allow: it can only narrow the contract's rules", () => {
    for (const readOnly of [true, false]) for (const rule of scopeRules({ session: "opencode", allowedOrigins: [], readOnly })) expect(rule.effect).not.toBe("allow")
  })
})

describe("insertScopeRules", () => {
  test("inserts after the contract's last generated rule, so the narrowing comes after the allow", () => {
    const rules = base()
    const generated = rulesFor(manifest as Manifest, "all")
    const last = Math.max(...generated.map((rule) => rules.findIndex((held) => held.action === rule.action && held.resource === rule.resource && held.effect === rule.effect)))
    expect(insertScopeRules(rules, generated, scopeRules({ session: "opencode", allowedOrigins: [], readOnly: false }))).toBe(true)
    expect(rules.findLastIndex((rule) => rule.action === "browse_session_new" && rule.effect === "deny")).toBeGreaterThan(last)
    expect(rules.findLastIndex((rule) => rule.action === "browse_execute" && rule.effect === "ask")).toBeGreaterThan(last)
  })

  test("removes a previous narrowing before inserting the new one, so a reload never doubles it", () => {
    const rules = base()
    const generated = rulesFor(manifest as Manifest, "all")
    insertScopeRules(rules, generated, scopeRules({ session: "a", allowedOrigins: [], readOnly: true }))
    const once = JSON.stringify(rules)
    insertScopeRules(rules, generated, scopeRules({ session: "a", allowedOrigins: [], readOnly: true }))
    expect(JSON.stringify(rules)).toBe(once)
    insertScopeRules(rules, generated, scopeRules({ session: "a", allowedOrigins: [], readOnly: false }))
    expect(rules.filter((rule) => rule.action === "browse_execute")).toHaveLength(2)
  })

  test("appends when the agent has no generated block, which fails closed", () => {
    const rules: PermissionRule[] = [{ action: "*", resource: "*", effect: "deny" }]
    const generated = rulesFor(manifest as Manifest, "all")
    expect(insertScopeRules(rules, generated, scopeRules({ session: "a", allowedOrigins: [], readOnly: false }))).toBe(true)
    expect(rules.at(-1)).toEqual({ action: "browse_execute", resource: "*", effect: "ask" })
  })

  test("removeScopeRules removes every profile's block", () => {
    const rules = base()
    const generated = rulesFor(manifest as Manifest, "all")
    insertScopeRules(rules, generated, scopeRules({ session: "a", allowedOrigins: [], readOnly: true }))
    expect(removeScopeRules(rules)).toBe(true)
    expect(rules.some((rule) => rule.effect === "deny" && rule.action.startsWith("browse_"))).toBe(false)
    expect(rules).toHaveLength(1 + generated.length)
  })
})
