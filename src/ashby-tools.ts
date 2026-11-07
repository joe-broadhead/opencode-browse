// Every fact the plugin keeps about Ashby's tools: their names, without the `ashby_` server prefix, sorted by what they
// do. The default rules, the tools RPC's methods, status's unknown and denied tools and the tests all derive from these
// lists; `jelly.tools` in package.json and the skills' call examples are checked against them. Keep this file free of
// runtime imports.
//
// The names and classes come from Ashby's own list of its MCP tools (docs.ashbyhq.com, "Ashby MCP Server (Beta)"),
// recorded in test/unit/ashby-tools.json; the drift test pins them to it. That list gives no schemas or annotations,
// so each tool's class comes from Ashby's description of it, and PARAMETERS stays empty until a tool list from a
// signed-in server is recorded (CONTRIBUTING.md, "Drift check"). Ashby may list fewer tools for a user with less
// access, so a known tool missing from a live list is normal and never reported.

/** Known reads: each only reads, by Ashby's description, and sends nothing beyond its query. They run without asking. */
export const READ_TOOLS: readonly string[] = [
  "describe_object_fields",
  "filter_records",
  "get_candidate",
  "get_interview_details",
  "get_interview_plan",
  "get_job_pipeline",
  "get_pending_tasks",
  "get_record_details",
  "get_submitted_feedback",
  "get_upcoming_interviews",
  "search_product_docs",
  "search_records_by_name",
]

/**
 * Known writes: they ask before they run. Each changes records the hiring team sees, and one can reach the candidate:
 * `consider_candidate_for_job` starts an application at the job's first stage, whose automatic activities run, and
 * some organisations email candidates there.
 */
export const WRITE_TOOLS: readonly string[] = ["add_note_to_candidate", "consider_candidate_for_job", "create_candidate"]

/**
 * Off by default; a deny also hides them. A user or organisation turns one back on with a later `ask` rule for it.
 * - `change_application_stage`: moves an application to another stage, or archives it. Archiving runs the Archived
 *   stage's automatic activities, so the candidate still gets any automated archive email. A decision on a person,
 *   which can't be taken back once the email has gone.
 * - `submit_mcp_feedback`: sends text to Ashby's team, and Ashby invites it whenever something doesn't work, so a model
 *   could send it unasked, with candidate details from a failed call.
 */
export const DENIED_TOOLS: readonly string[] = ["change_application_stage", "submit_mcp_feedback"]

/**
 * Each known tool's input parameters, as `name:type`, with `*` after a required name, in the input schema's order. Empty
 * until a tool list from a signed-in server is recorded: Ashby publishes no schemas. The drift script compares a saved
 * tool list with this record and lists every tool still to record; the skills test lets a skill write a literal call
 * only with parameters recorded here, so until then the skills name tools without their inputs.
 */
export const PARAMETERS: Readonly<Record<string, readonly string[]>> = {}

type ToolClass = "read" | "write" | "denied" | "unknown"

export function classify(name: string): ToolClass {
  if (READ_TOOLS.includes(name)) return "read"
  if (WRITE_TOOLS.includes(name)) return "write"
  if (DENIED_TOOLS.includes(name)) return "denied"
  return "unknown"
}
