import type { Plugin } from "@opencode/plugin"
import { errorText, SERVER_NAME } from "./constants.js"
import { reasonOf } from "./redact.js"
import { scopedEffectOf, TOOLS, type Effect } from "./browse-tools.js"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: Effect
}

/** The host's permission action for an MCP tool of the `browse` server. */
const actionOf = (tool: string) => `${SERVER_NAME}_${tool}`
const rule = (tool: string, effect: Effect): Rule => ({ action: actionOf(tool), resource: "*", effect })

export interface RuleSet {
  /** True when the scoped profile applies: a pinned session, with the tools that could leave it off. */
  readonly scoped: boolean
  /** The pinned session's read-only flag, which decides whether `execute` runs or asks in the scoped profile. */
  readonly readOnly: boolean
}

/**
 * The rules, in order, because the last matching rule wins:
 *   1. every `browse_*` is off, so a tool browse adds later is off until a release classifies it;
 *   2. one rule per known tool, by its exact name, from src/browse-tools.ts.
 * Reads and tab cleanup run; `execute`, the session tools, the settings and the three tools that act with the user's
 * secrets or widen reach ask (owner ruling, 2026-11-07). Nothing known is denied.
 *
 * The scoped profile (a pinned session) is stricter: the session tools that could leave it or widen it are off, and
 * `execute` runs only when the pinned session is read-only, where the relay refuses all input.
 */
export const defaultRules = (set: RuleSet = { scoped: false, readOnly: false }): Rule[] => [
  rule("*", "deny"),
  ...TOOLS.map((tool) => rule(tool.name, set.scoped ? scopedEffectOf(tool.name, set.readOnly) : tool.effect)),
]

const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

/**
 * True when the default rules appear as one contiguous block anywhere after the agent's first base allow, inserted
 * by the plugin or pasted by the user. Other plugins insert their blocks at the same place, so the block need not
 * come first. False without a base allow.
 */
export function hasDefaultRules(permissions: readonly Rule[], set: RuleSet = { scoped: false, readOnly: false }) {
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  const rules = defaultRules(set)
  return permissions.some((_, start) => start > base && rules.every((item, offset) => permissions[start + offset] !== undefined && same(permissions[start + offset]!, item)))
}

/**
 * Splices `rules` in right after the agent's base `* * allow`, by index. Everything later still wins: the agent's
 * own stricter rules, the user's `permissions`, and saved approvals. Agents without a base allow, or that already
 * carry the rules, are left alone: there the block's asks would not be reached anyway, and inserting at index 0 would
 * turn a default deny into an ask. Returns whether it inserted.
 */
export function insertRules(permissions: Rule[], rules: readonly Rule[], set: RuleSet = { scoped: false, readOnly: false }) {
  if (hasDefaultRules(permissions, set)) return false
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  permissions.splice(base + 1, 0, ...rules.map((item) => ({ ...item })))
  return true
}

/** Registers the default rules for every agent. Synchronous and never throws; a failure is kept for status. */
export function registerDefaultRules(
  agent: Pick<Plugin.Context["agent"], "transform">,
  rules: readonly Rule[],
  set: RuleSet,
  report: (problem: string | undefined) => void,
) {
  return agent.transform((editor) => {
    try {
      for (const { id } of editor.list()) editor.update(id, (info) => void insertRules(info.permissions, rules, set))
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
 * Agents where a new browse tool would run without asking: a base allow, no default rules after it, and nothing else
 * in the agent's own rules that asks or denies for it. An agent whose rules already stop every browse tool needs no
 * fix, and one without a base allow gets no rules.
 */
export const unguardedAgents = (agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]) =>
  agents
    .filter((agent) => agent.permissions.some((item) => same(item, BASE_ALLOW)) && !hasDefaultRules(agent.permissions) && evaluate(agent.permissions, actionOf("new_tool")) === "allow")
    .map((agent) => agent.id)
