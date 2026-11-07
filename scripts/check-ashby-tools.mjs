// Maintainer-run drift check against a saved copy of Ashby's tool list. It warns; nothing at runtime depends on it.
//
//   npm run drift -- <tools.json> [--strict]
//
// <tools.json> is a saved tool list, in either form:
// - OpenCode's tool list (`ctx.tool.list()`): `{ "tools": [{ "name", "description", "inputSchema" }] }`, names with or
//   without the `ashby_` prefix, or an MCP client's `tools/list` result, which adds `annotations`;
// - the research form: `{ "tools": [{ "name", "annotations", "inputs": ["name*:type", …] }] }`, where `annotations` and
//   `inputs` may be missing, as in a list of names from Ashby's docs (test/unit/ashby-tools.json).
// The script reads that file only: it never reads a credential and never calls Ashby. It compares the list with
// READ_TOOLS, WRITE_TOOLS, DENIED_TOOLS and PARAMETERS in src/ashby-tools.ts, and prints only tool names, parameter
// names and types, and Ashby's readOnlyHint and destructiveHint annotations. A known tool whose input the list gives but
// PARAMETERS does not record yet is drift: record it.
// Exit codes: 0 no drift, or drift without --strict; 1 drift with --strict; 2 usage or file error.
// Needs Node 22.18 or later, which loads the TypeScript file by stripping its types.
import { readFileSync } from "node:fs"

const USAGE = "Usage: npm run drift -- <tools.json> [--strict]"
const PREFIX = "ashby_"
// A sentence whose subject is the tool and whose verb changes or sends something: "Sends an email…", "This tool
// creates…". A known read whose description says so needs a second look. Nouns ("a Job Posting"), enum values (ARCHIVED,
// HIRED), other tools' names (change_application_stage) and instructions to call another tool ("Create a candidate")
// don't count.
const CHANGE_VERBS = "creates|updates|deletes|removes|edits|modifies|writes|sends|posts|uploads|archives|rejects|enrolls|saves|shares|publishes"
const CHANGE_SENTENCE = new RegExp(`^(?:this (?:tool|call) |it )?(${CHANGE_VERBS})\\b(?!\\s*:)`, "i")
// Two tools whose parameters overlap this much are reported as a possible rename.
const RENAME_OVERLAP = 0.6

let strict = false
let file
for (const arg of process.argv.slice(2)) {
  if (arg === "--strict") strict = true
  else if (!arg.startsWith("--") && file === undefined) file = arg
  else fail(`unknown argument "${arg}". ${USAGE}`)
}
if (file === undefined) fail(`no tool list given. ${USAGE}`)
if (!process.features.typescript) fail(`Node ${process.versions.node} cannot load TypeScript files. Use Node 22.18 or later.`)

const known = await loadKnown()
const live = readToolList(file)

const added = [...live.keys()].filter((name) => !known.classOf.has(name)).sort()
const removed = [...known.classOf.keys()].filter((name) => !live.has(name)).sort()
const renamed = added.flatMap((name) => {
  const now = plain(live.get(name).params)
  const match = removed.find((old) => overlap(now, plain(known.parameters[old] ?? [])) >= RENAME_OVERLAP)
  return match ? [`${match} -> ${name}`] : []
})
const parameters = [...live]
  .filter(([name, tool]) => known.parameters[name] && tool.params !== null)
  .flatMap(([name, tool]) => {
    const recorded = parse(known.parameters[name])
    const now = new Map(tool.params.map((param) => [param.name, param]))
    const changes = [
      ...[...now.keys()].filter((param) => !recorded.has(param)).map((param) => `+${describe(now.get(param))}`),
      ...[...recorded.keys()].filter((param) => !now.has(param)).map((param) => `-${param}`),
      ...[...now.values()].filter((param) => recorded.has(param.name)).flatMap((param) => {
        const before = recorded.get(param.name)
        const notes = []
        if (param.required !== before.required) notes.push(param.required ? "now required" : "now optional")
        if (param.type && before.type && param.type !== before.type) notes.push(`${before.type} -> ${param.type}`)
        return notes.length ? [`${param.name} (${notes.join(", ")})`] : []
      }),
    ]
    return changes.length ? [`${name}: ${changes.join(" ")}`] : []
  })
  .sort()
const unrecorded = [...live]
  .filter(([name, tool]) => known.classOf.has(name) && !known.parameters[name] && tool.params !== null)
  .map(([name, tool]) => `${name}: ${tool.params.map(describe).join(" ") || "(no parameters)"}`)
  .sort()
const schemas = [...live.values()].some((tool) => tool.params !== null)
const annotated = [...live.values()].some((tool) => tool.annotations !== undefined)
const reclassified = [...live]
  .filter(([name, { annotations: hints = {} }]) => {
    const kind = known.classOf.get(name)
    return (kind === "read" && (hints.readOnlyHint === false || hints.destructiveHint === true)) || (kind !== undefined && kind !== "read" && hints.readOnlyHint === true)
  })
  .map(([name]) => name)
  .sort()
const changeWording = [...live]
  .flatMap(([name, tool]) => {
    const verb = known.classOf.get(name) === "read" ? changeVerb(tool.description) : undefined
    return verb ? [`${name}  (${verb})`] : []
  })
  .sort()

const count = (kind) => [...live.keys()].filter((name) => known.classOf.get(name) === kind).length
console.log(`The list holds ${live.size} tools: ${count("read")} read, ${count("write")} write, ${count("denied")} denied, ${added.length} unclassified.`)
section("Added: listed by Ashby, in no list of src/ashby-tools.ts", added, true)
section("Removed: in src/ashby-tools.ts, not in this list (an account lists only the tools for the products it has)", removed, false)
section("Possibly renamed: a removed tool and an added one take mostly the same parameters", renamed, false)
section("Parameters changed: the input differs from PARAMETERS (the skills' examples use these names)", parameters, false)
section("Parameters to record: the list gives this known tool's input, which PARAMETERS does not have yet", unrecorded, false)
section("Change wording: a known read's description now says it creates, changes or sends something; read it", changeWording, false)
if (!schemas) console.log("\nNot checked: this list gives no input schemas, so no parameters were compared.")
if (annotated) section("Reclassified: the lists disagree with Ashby's annotations", reclassified, true)
else {
  console.log("\nNot checked: this list carries no annotations (OpenCode's tool list never does), so it can't show that Ashby")
  console.log("marked a tool as changing data. Only a description's wording hints at that: read each new or changed description.")
}

// A known tool missing from one account's list is normal, so removals alone are not drift.
const drift = added.length + parameters.length + unrecorded.length + changeWording.length + (annotated ? reclassified.length : 0)
if (!drift) {
  console.log(removed.length ? "\nNo drift apart from the removed tools above." : "\nNo drift.")
  process.exit(0)
}
console.log(`\nDrift: ${drift} item(s). Update src/ashby-tools.ts, package.json's jelly.tools and the skills after checking each tool's behaviour.`)
process.exit(strict ? 1 : 0)

function section(title, names, withHints) {
  if (!names.length) return
  console.log(`\n${title}:`)
  for (const name of names) console.log(`  ${printable(name)}${withHints && live.get(name)?.annotations ? `  ${hints(live.get(name).annotations)}` : ""}`)
}

function hints(annotations) {
  const show = (value) => (typeof value === "boolean" ? String(value) : "unset")
  return `readOnlyHint=${show(annotations.readOnlyHint)} destructiveHint=${show(annotations.destructiveHint)}`
}

/** `name*:type` entries as a map of name to `{ name, required, type }`. */
function parse(entries) {
  return new Map(entries.map((entry) => {
    const [head, type] = String(entry).split(":")
    const required = head.endsWith("*")
    const name = required ? head.slice(0, -1) : head
    return [name, { name, required, ...(type ? { type } : {}) }]
  }))
}

function describe(param) {
  return `${param.name}${param.required ? "*" : ""}${param.type ? `:${param.type}` : ""}`
}

/** A tool's parameter names, from recorded `name*:type` entries or parsed parameters; none when unknown. */
function plain(params) {
  return new Set((params ?? []).map((param) => (typeof param === "string" ? param.split(":")[0].replace(/\*$/, "") : param.name)))
}

/** The share of two parameter sets that both have. */
function overlap(a, b) {
  const both = [...a].filter((name) => b.has(name)).length
  const either = new Set([...a, ...b]).size
  return either ? both / either : 0
}

// Names come from the server: print plain text as is and quote anything else.
function printable(text) {
  return /^[A-Za-z0-9_.\-:+<>|*() ]{1,300}$/.test(text) ? text : JSON.stringify(text.slice(0, 300))
}

function readToolList(path) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    fail(`cannot read ${JSON.stringify(path)} as JSON (${clean(error?.code ?? error?.message ?? error)}).`)
  }
  if (!Array.isArray(parsed?.tools)) fail(`${JSON.stringify(path)} has no "tools" array. Save a tool list as CONTRIBUTING says. ${USAGE}`)
  const tools = new Map()
  for (const tool of parsed.tools) {
    if (typeof tool?.name !== "string") continue
    const name = tool.name.startsWith(PREFIX) ? tool.name.slice(PREFIX.length) : tool.name
    tools.set(name, {
      description: typeof tool.description === "string" ? tool.description : "",
      params: paramsOf(tool),
      ...(tool.annotations && typeof tool.annotations === "object" ? { annotations: tool.annotations } : {}),
    })
  }
  return tools
}

/** The change verb of the first sentence in which the tool itself changes or sends something, if any. */
function changeVerb(description) {
  const prose = description
    .replace(/`[^`]*`/g, " ")
    .replace(/<\/?[a-z_]+>/gi, "\n")
    .replace(/\b[a-z]+_[a-z0-9_]+\b(?:\([^)]*\))?/gi, " ")
    .replace(/\b[A-Z]{2,}\b/g, " ")
  for (const raw of prose.split(/\n+|(?<=[.!?])\s+/)) {
    const sentence = raw.replace(/^[\s\-*•\d.)]+/, "")
    const match = CHANGE_SENTENCE.exec(sentence)
    if (match) return match[1]
  }
  return undefined
}

/** A JSON Schema property's type, as PARAMETERS records it: `string`, `array<object>|null` and so on. */
function shape(property) {
  if (!property || typeof property !== "object") return "any"
  if (Array.isArray(property.anyOf)) return property.anyOf.map(shape).join("|")
  if (Array.isArray(property.type)) return property.type.join("|")
  if (property.type === "array") return `array<${shape(property.items)}>`
  if (typeof property.type === "string") return property.type
  return "any"
}

/** A tool's parameters from its JSON Schema, or from the research form's `inputs`; null when the list gives neither. */
function paramsOf(tool) {
  if (Array.isArray(tool.inputs)) return [...parse(tool.inputs).values()]
  if (!tool.inputSchema || typeof tool.inputSchema !== "object") return null
  const schema = tool.inputSchema
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return Object.entries(properties).map(([name, property]) => ({
    name,
    required: required.has(name),
    type: shape(property),
  }))
}

async function loadKnown() {
  let module
  try {
    module = await import(new URL("../src/ashby-tools.ts", import.meta.url).href)
  } catch (error) {
    fail(`cannot load src/ashby-tools.ts (${error?.code ?? error?.message ?? error}). Keep it free of runtime imports so Node can strip its types.`)
  }
  const classOf = new Map()
  for (const [list, kind] of [["READ_TOOLS", "read"], ["WRITE_TOOLS", "write"], ["DENIED_TOOLS", "denied"]]) {
    if (!Array.isArray(module[list])) fail(`src/ashby-tools.ts must export ${list} as an array of tool names.`)
    for (const name of module[list]) classOf.set(name, kind)
  }
  if (!module.PARAMETERS || typeof module.PARAMETERS !== "object") fail("src/ashby-tools.ts must export PARAMETERS, each tool's parameters.")
  return { classOf, parameters: module.PARAMETERS }
}

function clean(text) {
  return String(text ?? "no message").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200)
}

function fail(message) {
  console.error(`check-ashby-tools: ${message}`)
  process.exit(2)
}
