// The `report` method: browse's full diagnostic answer — binary, relay, extension, scope, managed browser, recording
// readiness, the agents that lack the rules, and the one next step. `/browse-status` prints it and the status dialog
// reads it over the contract's one RPC id; the contract's `status` is the short answer for apps and agents.
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { REPORT_SCHEMA, type Report } from "../report.js"
import { unguarded } from "./unguarded.js"

const EMPTY = { type: "object", properties: {}, additionalProperties: false }

export interface ReportParts {
  readonly report: (unguardedAgents: readonly string[], extraProblems?: readonly string[]) => Promise<Report>
}

export function reportHandler(parts: ReportParts): MethodHandler {
  return {
    description: "Read Browse's diagnostic report: binary, relay, extension, scope, managed browser, recording readiness and the next step.",
    input: EMPTY,
    output: REPORT_SCHEMA,
    async run(_input, call) {
      const agents = await unguarded(call)
      return parts.report(agents.agents, agents.problem === undefined ? [] : [agents.problem])
    },
  }
}
