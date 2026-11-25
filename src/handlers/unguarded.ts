// The one place a handler reads the agents that lack the generated rules. `register` gives every call
// `unguardedAgents()`, whose result is `{ ok: true, agents }` or `{ ok: false, error }`; a failed read is unknown, never
// zero, so it becomes a status problem and the list stays empty. The raw result goes to `statusAnswer`, which reports a
// failure itself.
import type { UnguardedAgentsResult } from "@we-the-rebel-alliance/plugin-contract/access"
import { redactReason } from "@we-the-rebel-alliance/plugin-contract/accounts"

export interface UnguardedResult {
  readonly result: UnguardedAgentsResult
  readonly agents: readonly string[]
  readonly problem?: string
}

export async function unguarded(call: { unguardedAgents(): Promise<UnguardedAgentsResult> }): Promise<UnguardedResult> {
  const result = await call.unguardedAgents()
  if (result.ok) return { result, agents: [...result.agents] }
  return {
    result,
    agents: [],
    problem: `UNAVAILABLE: the agent list could not be read (${redactReason(result.error)}). Next step: restart OpenCode, then read status again.`,
  }
}
