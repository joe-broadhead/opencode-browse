// The `scope` option's narrowing. The contract's `access` module owns the default rules for every method; this module
// only narrows them when a person pins the server to one browse session, so the session tools that could leave it are
// off and `execute` asks unless the pinned session is read-only (the relay then refuses all input). It emits `deny` and
// `ask` only: it can never widen what `access` allows.
import type { Plugin } from "@opencode/plugin"
import { accessLevel, rulesFor, toolAction, type PermissionRule } from "@we-the-rebel-alliance/plugin-contract/access"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { SERVER_NAME } from "./constants.js"
import type { Options, ScopeOptions } from "./options.js"

/** The session tools that could leave or widen the pinned session. */
const SESSION_TOOLS = ["session_new", "session_use", "session_adopt", "session_delete", "session_allowlist"] as const

const same = (left: PermissionRule, right: PermissionRule) => left.action === right.action && left.resource === right.resource && left.effect === right.effect

/** The narrowing for one scope: the five session tools off, and `execute` asking unless the session refuses input. */
export function scopeRules(scope: ScopeOptions): readonly PermissionRule[] {
  const rules: PermissionRule[] = SESSION_TOOLS.map((tool) => ({ action: toolAction(SERVER_NAME, tool), resource: "*", effect: "deny" }))
  if (!scope.readOnly) rules.push({ action: toolAction(SERVER_NAME, "execute"), resource: "*", effect: "ask" })
  return rules
}

/** Every narrowing a previous load may have inserted, so a reload or a removed option cannot leave a stale block. */
const profiles = (): readonly (readonly PermissionRule[])[] => [scopeRules({ session: "", allowedOrigins: [], readOnly: true }), scopeRules({ session: "", allowedOrigins: [], readOnly: false })]

/** The index range of a contiguous block equal to `block`, or undefined. */
function findBlock(permissions: readonly PermissionRule[], block: readonly PermissionRule[]): number | undefined {
  for (let start = 0; start < permissions.length; start++) {
    if (block.every((rule, offset) => permissions[start + offset] !== undefined && same(permissions[start + offset]!, rule))) return start
  }
  return undefined
}

/** Removes every narrowing block a previous load inserted. Returns whether anything was removed. */
export function removeScopeRules(permissions: PermissionRule[]): boolean {
  let removed = false
  for (const block of profiles()) {
    for (;;) {
      const at = findBlock(permissions, block)
      if (at === undefined) break
      permissions.splice(at, block.length)
      removed = true
    }
  }
  return removed
}

/**
 * Inserts the narrowing after the contract's generated block, so the contract's own `allow`/`ask`/`deny` still decides
 * first and a rule the person adds later still decides last. With no generated block (an agent without a base allow)
 * the narrowing is appended, which fails closed.
 */
export function insertScopeRules(permissions: PermissionRule[], generated: readonly PermissionRule[], additions: readonly PermissionRule[]): boolean {
  const before = JSON.stringify(permissions)
  removeScopeRules(permissions)
  let at = -1
  for (const [index, held] of permissions.entries()) {
    if (generated.some((rule) => same(held, rule))) at = index
  }
  if (at === -1) permissions.push(...additions.map((rule) => ({ ...rule })))
  else permissions.splice(at + 1, 0, ...additions.map((rule) => ({ ...rule })))
  return JSON.stringify(permissions) !== before
}

/**
 * Applies the narrowing to every agent. Called once, after `register` has installed the contract's rules. Never
 * throws: a transform that fails is reported as a problem for status.
 */
export async function applyScopeNarrowing(
  ctx: { readonly agent: Pick<Plugin.Context["agent"], "transform"> },
  manifest: Manifest,
  options: Options,
  report: (problem: string | undefined) => void,
): Promise<void> {
  if (options.scope === undefined) return
  const level = accessLevel({ access: options.access })
  if (!level.ok) return
  const generated = rulesFor(manifest, level.value)
  const additions = scopeRules(options.scope)
  try {
    await ctx.agent.transform((editor) => {
      for (const agent of editor.list()) {
        const permissions = agent.permissions as PermissionRule[]
        if (insertScopeRules(permissions, generated, additions)) editor.update(agent.id, (target) => void (target.permissions = permissions))
      }
    })
    report(undefined)
  } catch (error) {
    report(`SCOPE_UNREACHABLE: Browse could not narrow the pinned session's rules (${error instanceof Error ? error.message : String(error)}). Next step: restart OpenCode, then run /browse-doctor.`)
  }
}
