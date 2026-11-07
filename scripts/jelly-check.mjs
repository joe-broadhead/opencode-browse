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
  own(JSON.stringify(keys) === JSON.stringify(["contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"]), `jelly has the keys ${keys.join(", ")}`)
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
