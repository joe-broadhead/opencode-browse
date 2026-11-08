import type { Plugin } from "@opencode/plugin"
import { errorText, SERVER_NAME } from "./constants.js"
import { reasonOf } from "./redact.js"
import { ACCESS_VALUES, accessEffect, defaultEffectOf, SCOPED_EFFECTS, TOOLS, type Access, type Effect } from "./browse-tools.js"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: Effect
}

/** The host's permission action for an MCP tool of the `browse` server. */
const actionOf = (tool: string) => `${SERVER_NAME}_${tool}`
const rule = (tool: string, effect: Effect): Rule => ({ action: actionOf(tool), resource: "*", effect })

export interface RuleSet {
  /** How much the plugin's own tools may do without asking. */
  readonly access: Access
  /** True when the scoped profile applies: a pinned session, with the tools that could leave it off. */
  readonly scoped: boolean
  /** The pinned session's read-only flag, which decides whether `execute` runs in the scoped profile. */
  readonly readOnly: boolean
}

const DEFAULT_SET: RuleSet = { access: "all", scoped: false, readOnly: false }

/**
 * The rules, in order, because the last matching rule wins:
 *   1. `browse_*` is allowed, so a tool browse adds later runs at once (an unknown name resolves through this rule);
 *   2. one rule per known tool, by its exact name, from src/browse-tools.ts, with the effect the `access` option gives
 *      its class — allow under `all`, ask for the changes under `ask-changes`, deny them under `read-only`.
 *
 * The scoped profile (a pinned session, which the user turns on) is stricter: the session tools that could leave it or
 * widen it are off, and `execute` runs only when the pinned session is read-only, where the relay refuses all input.
 */
export const defaultRules = (set: RuleSet = DEFAULT_SET): Rule[] => [
  // The namespace rule follows the access posture, so a tool browse adds later is usable at once under the default
  // and cannot slip past a restriction the user asked for.
  rule("*", accessEffect("unknown", set.access)),
  ...TOOLS.map((tool) => {
    const scoped = set.scoped ? SCOPED_EFFECTS[tool.name] : undefined
    if (scoped !== undefined) return rule(tool.name, scoped)
    // A pinned session decides execute: it runs when the session refuses input, and asks when input is allowed.
    if (set.scoped && tool.name === "execute") return rule(tool.name, set.readOnly ? "allow" : "ask")
    return rule(tool.name, defaultEffectOf(tool.name, set.access))
  }),
]

/**
 * A conflicting server holding the name `browse` is not ours, so its tools are denied by exact name rather than left to
 * the default allow. This is conflict handling, not a permission posture.
 */
export const conflictRules = (): Rule[] => [
  { action: "opencode_browser_*", resource: "*", effect: "deny" },
  rule("*", "deny"),
]

/** The profiles a block may be from: the default, and the two scoped variants. Upgrade removes whichever is present. */
const PROFILE_SETS: readonly RuleSet[] = ACCESS_VALUES.flatMap((access) => [
  { access, scoped: false, readOnly: false },
  { access, scoped: true, readOnly: false },
  { access, scoped: true, readOnly: true },
])
const profileBlocks = (): Rule[][] => PROFILE_SETS.map((set) => defaultRules(set))

const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

/** The index range of a contiguous block equal to `rules`, after `from`, or undefined. */
function findBlock(permissions: readonly Rule[], rules: readonly Rule[], from: number): number | undefined {
  for (let start = from; start < permissions.length; start++) {
    if (rules.every((item, offset) => permissions[start + offset] !== undefined && same(permissions[start + offset]!, item))) return start
  }
  return undefined
}

/** True when the block for `set` is present as one contiguous run anywhere after the agent's first base allow. */
export function hasDefaultRules(permissions: readonly Rule[], set: RuleSet = DEFAULT_SET) {
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  return findBlock(permissions, defaultRules(set), base + 1) !== undefined
}

/** True when any profile's block is present: the agent is guarded, whatever the profile it last received. */
export function hasAnyRules(permissions: readonly Rule[]) {
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  return profileBlocks().some((block) => findBlock(permissions, block, base + 1) !== undefined)
}

/**
 * Removes every profile's block (all contiguous runs), so an upgrade from one profile to another — or the removal of
 * `scope` — cannot leave the old, deciding block in front of the new one. Returns whether anything was removed.
 */
export function removeRules(permissions: Rule[]): boolean {
  let removed = false
  for (const block of profileBlocks()) {
    for (;;) {
      const at = findBlock(permissions, block, 0)
      if (at === undefined) break
      permissions.splice(at, block.length)
      removed = true
    }
  }
  return removed
}

/**
 * Removes any existing profile block, then splices `rules` in right after the agent's base `* * allow`. Everything
 * later still wins: the agent's own stricter rules, the user's `permissions`, and saved approvals. Agents without a
 * base allow, or that already carry exactly these rules, are left alone: inserting at index 0 would turn a default
 * deny into an ask. Returns whether it changed anything.
 */
export function insertRules(permissions: Rule[], rules: readonly Rule[]) {
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  const key = (block: readonly Rule[]) => JSON.stringify(block)
  const active = key(rules)
  // Already exactly this block, and no other profile's block to remove: nothing changes.
  if (findBlock(permissions, rules, base + 1) !== undefined && !profileBlocks().some((block) => key(block) !== active && findBlock(permissions, block, 0) !== undefined)) return false
  removeRules(permissions)
  const at = permissions.findIndex((item) => same(item, BASE_ALLOW))
  permissions.splice(at + 1, 0, ...rules.map((item) => ({ ...item })))
  return true
}

/** Registers the default rules for every agent. Synchronous and never throws; a failure is kept for status. */
export function registerDefaultRules(
  agent: Pick<Plugin.Context["agent"], "transform">,
  rules: readonly Rule[],
  report: (problem: string | undefined) => void,
) {
  return agent.transform((editor) => {
    try {
      for (const { id } of editor.list()) editor.update(id, (info) => void insertRules(info.permissions, rules))
      report(undefined)
    } catch (error) {
      report(errorText("RULES_NOT_ADDED", `Browse's default permission rules could not be added (${reasonOf(error)}), so Browse tools may run without asking.`, "Restart OpenCode."))
    }
  })
}

const wildcard = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)

/** The host's evaluation for an MCP call (resource `*`): the last matching rule wins, and no match asks. */
export function evaluate(permissions: readonly Rule[], action: string): Effect {
  return permissions.findLast((item) => wildcard(item.action).test(action) && wildcard(item.resource).test("*"))?.effect ?? "ask"
}

/**
 * Agents where a new browse tool would run without asking: a base allow, no block of either profile after it, and
 * nothing else in the agent's own rules that asks or denies for it. An agent whose rules already stop every browse
 * tool needs no fix, and one without a base allow gets no rules.
 */
export const unguardedAgents = (agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]) =>
  agents
    .filter((agent) => agent.permissions.some((item) => same(item, BASE_ALLOW)) && !hasAnyRules(agent.permissions) && evaluate(agent.permissions, actionOf("new_tool")) === "allow")
    .map((agent) => agent.id)
