// The one handler table `register` takes: browse's own methods, and nothing else. The 18 pass-through MCP tools are
// declared in `capabilities.methods` and owned by the browse MCP server: the register refuses a handler for them and
// does not proxy them.
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Report } from "../report.js"
import { reportHandler } from "./report.js"
import { statusHandler } from "./status.js"

export interface HandlerParts {
  readonly manifest: Manifest
  readonly version: string
  readonly hostVersion: string
  readonly report: (unguardedAgents: readonly string[], extraProblems?: readonly string[]) => Promise<Report>
}

export function createHandlers(parts: HandlerParts): HandlerTable {
  return {
    status: statusHandler(parts),
    report: reportHandler(parts),
  }
}
