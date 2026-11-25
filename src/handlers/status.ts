// The contract's `status` (contract §11): the short answer an app reads, built by `statusAnswer` from the manifest,
// the versions, the empty account list and the problems setup recorded. Browse has no accounts, so the answer lists
// none; the next step comes from the diagnostic report, which knows the relay, the extension and the binary.
import { NO_ACCOUNTS, redactReason, STATUS_SCHEMA, statusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { unguarded } from "./unguarded.js"

const EMPTY = { type: "object", properties: {}, additionalProperties: false }

export interface StatusParts {
  readonly manifest: Manifest
  readonly version: string
  readonly hostVersion: string
  readonly report: (unguardedAgents: readonly string[], extraProblems?: readonly string[]) => Promise<{ readonly problems: readonly string[]; readonly nextStep: string }>
}

/** The status handler: a short call to the contract's builder, with browse's next step in place of the first problem. */
export function statusHandler(parts: StatusParts): MethodHandler {
  return {
    description: "Read Browse's state, its host range and its account list (empty: browse is local).",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input, call) {
      const agents = await unguarded(call)
      const report = await parts.report(agents.agents, agents.problem === undefined ? [] : [agents.problem])
      const answer = statusAnswer({
        manifest: parts.manifest,
        version: parts.version,
        hostVersion: parts.hostVersion,
        accounts: NO_ACCOUNTS,
        problems: report.problems,
        unguardedAgents: agents.agents,
      })
      // The report's next step is the actionable line; when it has nothing to add, a recorded problem is the line.
      const nextStep = report.nextStep === "Nothing to do." ? (report.problems.length > 0 ? redactReason(report.problems[0]!) : null) : redactReason(report.nextStep)
      return { ...answer, nextStep }
    },
  }
}
