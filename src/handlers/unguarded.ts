// The one place a handler reads the agents that lack the generated rules. `register` gives every call
// `unguardedAgents()`; a failure is unknown, never zero, so it becomes a status problem instead of a silent empty list.
import { redactReason } from "@we-the-rebel-alliance/plugin-contract/accounts"

export interface UnguardedResult {
  readonly agents: readonly string[]
  readonly problem?: string
}

export async function unguarded(call: { unguardedAgents(): Promise<readonly string[]> }): Promise<UnguardedResult> {
  try {
    return { agents: [...(await call.unguardedAgents())] }
  } catch (error) {
    return { agents: [], problem: `UNAVAILABLE: the agent list could not be read (${redactReason(error instanceof Error ? error.message : String(error))}). Next step: restart OpenCode, then read status again.` }
  }
}
