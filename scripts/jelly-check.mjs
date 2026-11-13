// Validates this package's Jelly declaration against the contract Jelly reads, offline: the exact key set, the summary
// length cap, the icon rules, the tool entries, the skills and the sign-in list. `npm run jelly-check`.
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const problems = []
const own = (condition, message) => {
  if (!condition) problems.push(message)
}

const jelly = pkg.jelly
own(jelly !== undefined && typeof jelly === "object", "package.json has no jelly declaration")
if (jelly) {
  const keys = Object.keys(jelly).sort()
  own(JSON.stringify(keys) === JSON.stringify(["actions", "contributes", "icon", "inbox", "nativeData", "notices", "rpc", "signIns", "skills", "summary", "title", "tools", "views"]), `jelly has the keys ${keys.join(", ")}`)
  own(typeof jelly.title === "string" && jelly.title.trim() !== "", "jelly.title must be a non-empty string")
  own(typeof jelly.summary === "string" && jelly.summary.length > 0 && jelly.summary.length <= 120, `jelly.summary is ${typeof jelly.summary === "string" ? jelly.summary.length : "not a string"} characters; the cap is 120`)
  own(jelly.icon === "assets/icon.svg", "jelly.icon must be assets/icon.svg")
  own(existsSync(join(root, jelly.icon ?? "")), "the jelly icon file is missing")
  own(Array.isArray(jelly.skills) && jelly.skills.every((id) => typeof id === "string" && existsSync(join(root, "skills", id, "SKILL.md"))), "every jelly skill must have skills/<id>/SKILL.md")
  own(Array.isArray(jelly.signIns) && jelly.signIns.every((entry) => entry && typeof entry.id === "string" && typeof entry.label === "string"), "jelly.signIns entries need an id and a label")
  own(Array.isArray(jelly.rpc), "jelly.rpc must be an array")
  own(Array.isArray(jelly.views), "jelly.views must be an array")
  own(jelly.contributes !== null && typeof jelly.contributes === "object", "jelly.contributes must be an object")
  for (const key of ["homeFeeds", "homeWidgets", "workKinds", "settings"]) own(Array.isArray(jelly.contributes?.[key]), `jelly.contributes.${key} must be an array`)
  own(Array.isArray(jelly.tools), "jelly.tools must be an array")
  for (const entry of jelly.tools ?? []) {
    own(typeof entry.name === "string" && entry.name.includes("."), `tool ${JSON.stringify(entry)} needs a dotted name`)
    own(typeof entry.permission === "string" && /^[a-z][a-z0-9_]*$/.test(entry.permission), `tool ${entry.name} has no permission action`)
    own(["allow", "ask", "deny"].includes(entry.effect), `tool ${entry.name} has the effect ${entry.effect}`)
    own(typeof entry.readOnly === "boolean", `tool ${entry.name} needs readOnly`)
    for (const key of Object.keys(entry)) own(["name", "permission", "effect", "readOnly"].includes(key), `tool ${entry.name} has the key ${key}`)
  }

  // The personal-browser binding (D103) and its per-task ask, by the rules jelly's contract applies
  // (plugin-native-data, plugin-views, plugin-actions and plugin-inbox).
  const permissions = new Set((jelly.tools ?? []).map((tool) => tool.permission))
  const rpc = new Map((jelly.rpc ?? []).map((method) => [method.name, method]))
  for (const method of jelly.rpc ?? []) {
    own(permissions.has(method.permission), `rpc ${method.name} must read under a declared tool permission`)
    own(!method.name.startsWith("act."), `rpc ${method.name} may not start with act.`)
  }
  const pages = new Set()
  for (const view of jelly.views ?? []) {
    own(typeof view.page === "string" && existsSync(join(root, view.page)), `view ${view.id} needs its page in the package`)
    own(pkg.files?.some((entry) => view.page === entry || view.page?.startsWith(`${entry}/`)), `view ${view.id}'s page must ship in files`)
    own(view.grants?.includes("rpc") === (view.rpc?.length > 0), `view ${view.id} names its methods exactly when it has the rpc grant`)
    for (const name of view.rpc ?? []) own(rpc.get(name)?.readOnly === true, `view ${view.id} may call only read-only methods: ${name}`)
    pages.add(view.id)
  }
  for (const action of jelly.actions ?? []) {
    own(action.views.every((view) => pages.has(view)), `action ${action.name} is called only by this plugin's pages`)
    if (action.preview !== undefined) own(rpc.get(action.preview)?.readOnly === true, `action ${action.name}'s preview must be a read-only method`)
  }
  for (const hint of jelly.nativeData ?? []) {
    own(hint.v === 1 && hint.capability === "personal-browser", "nativeData declares the personal browser only")
    const view = (jelly.views ?? []).find((item) => item.id === hint.view)
    own(view?.page !== undefined && view.grants.includes("rpc") && view.rpc.includes(hint.read) && rpc.get(hint.read)?.readOnly === true, "the native read must be its page view's granted, read-only method")
    own(hint.actions?.connect !== undefined && hint.actions.connect !== hint.actions.stop, "the personal browser needs two different actions")
    for (const name of Object.values(hint.actions ?? {})) {
      const action = (jelly.actions ?? []).find((item) => item.name === name)
      own(action?.class === "local" && action.confirm === "always" && action.views.includes(hint.view), `the personal browser's ${name} needs local access and confirmation every time`)
    }
  }
  if (jelly.inbox !== undefined) own(rpc.get(jelly.inbox.method)?.readOnly === true, "the inbox reads through a read-only method")
  for (const notice of jelly.notices ?? []) {
    own(["message", "mention", "request", "proposal", "commitment", "alert"].includes(notice.category), `notice ${notice.id} has the category ${notice.category}`)
    own(["name", "line", "count"].includes(notice.preview), `notice ${notice.id} has the preview ${notice.preview}`)
    own(typeof notice.label === "string" && notice.label.length > 0 && notice.label.length <= 40, `notice ${notice.id} needs a label of at most 40 characters`)
  }
}

// The three icon files and their declarations, as the kit requires.
if (pkg.opencode?.icons) {
  own(pkg.opencode.icons.length === 3, "opencode.icons must have three entries")
  own(pkg.opencode.icons[0]?.src === jelly?.icon, "opencode.icons[0].src must equal jelly.icon")
  for (const icon of pkg.opencode.icons) own(pkg.files?.includes(icon.src), `${icon.src} must be in files`)
}

const skills = existsSync(join(root, "skills")) ? readdirSync(join(root, "skills")) : []
own(skills.length === (jelly?.skills?.length ?? 0), `the package ships ${skills.length} skills but declares ${jelly?.skills?.length ?? 0}`)

for (const problem of problems) console.error(`jelly-check: ${problem}`)
if (problems.length) process.exit(1)
console.log(`jelly-check: valid — "${jelly.title}", summary ${jelly.summary.length}/120, ${jelly.tools.length} tools, ${jelly.skills.length} skills.`)
