# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this package's `package.json` as
JSON, without loading the plugin, when a person reviews the exact version, and uses it as follows.

Jelly names the plugin **Browse** (`jelly.title`), with the package name and version beneath. Under that name it shows
the one line in `jelly.summary`, and beside it the mark in `jelly.icon` (`assets/icon.svg`, shipped in the package):
Jelly reads that file once, when it records the plugin, and keeps it only if it is a clean SVG of drawing elements,
with no script, style, link or outside reference. The mark is the family's **Neutral slate** tile — a browser window
with a pointer, drawn by us — and not Anomaly's, OpenCode's or any browser's mark.

## Icons and vendor

`jelly.icon` stays `assets/icon.svg`, and `opencode.icons` declares the same mark three ways, in MCP's `Icon` shape:
the clean SVG (`sizes: ["any"]`), a 128×128 PNG and a 256×256 PNG, each with its `mimeType` and a relative `src` inside
the package. `opencode.icons[0].src` equals `jelly.icon`, so the two declarations cannot drift. `exports` exposes the
three files as `./icon.svg`, `./icon-128.png` and `./icon-256.png`, and all three ship in the tarball.

`opencode.vendor` is `{ "id": "anomaly", "name": "Anomaly", "domain": "anoma.ly" }`: the service behind the plugin is
Anomaly's browse, and `anoma.ly` is the vendor's own release domain, which browse's installer and release service
already use. It is deliberately not `opencode.ai`, which would put OpenCode's mark on a browse entry. A display app that has decided to show the
vendor's official mark reads the domain and fetches it from the vendor's own site, under the vendor's terms; the
official mark never passes through this package, its tarball or a CDN. The package carries no vendor marks, colours or
letterforms.

## Tools and permissions

18 tools are declared (4 read-only): the reads, the tab cleanup and the three captures run; the page action, the
session tools, the settings and the three tools that act with your credentials ask; none of the known 18 is off. A tool
browse adds later is not declared here, and Jelly does not ask about it; this plugin's own rules deny it until a
release classifies it.

Jelly's agents have no base "allow everything" rule, so this plugin's default rules, which it puts after that rule,
never reach them. Jelly writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow` changes nothing in
Jelly.

- Ask: `browse_execute` (the whole page-action surface), `browse_session_new`, `browse_session_use`,
  `browse_session_adopt`, `browse_session_reset`, `browse_session_delete`, `browse_session_allowlist`,
  `browse_settings`, `browse_secrets_run` and `browse_secrets_refresh`.
- Run: `browse_status`, `browse_session_list`, `browse_secrets_list`, `browse_secrets_status`, `browse_tabs_cleanup`,
  `browse_network`, `browse_recording`, `browse_flight_recorder`.

So a Jelly agent cannot drive the browser at all unless the person allows `browse_execute`; a person who allows it
should expect every page action to be approved one call at a time. Captures run, and they write real page content, so
a person who does not want that should turn `browse_network`, `browse_recording` and `browse_flight_recorder` off in
that agent's settings.

## Sign-in

None. There is no account, no OAuth and no `/connect` entry: the browser is paired locally with the relay, in the
browser's own options page. `jelly.signIns` is empty.

## Your Chrome, per task

Issue #3: an agent may use the person's own Chrome **per task, when the person allows it** —
never by default, never for good. Under jelly (the plugin sees jelly's engine hand-off) and in real mode, the plugin
wraps every `browse_*` tool's executor, the one place the model path, Code Mode and the `browse.tools` RPC all pass
through. A call from a conversation with no grant never reaches the MCP server.

- **A task** is one OpenCode session (the conversation) and the agent that runs it.
- **The ask.** The first gated call records `{ id, agent, task, origins, at }` — the task is the session's title, the
  origins are the `allowedOrigins` of a `session_new` or `session_allowlist`, else any site — and waits for the person
  for up to five minutes. A cancelled turn withdraws it.
- **Allow for this task** is the `browser.connect` action. It allows the ask named by `input.ask`, or the oldest one
  when jelly sends `{}`. With no ask pending the read reports `canControl: false`, so jelly offers no Connect and the
  Chrome cannot be allowed in advance.
- **The end.** The agent's `session_reset` or `session_delete` in that conversation, `browser.stop` (all, or one
  `session`), the conversation deleted or archived, an hour with no browse call, or the engine stopping. Nothing is
  written: no rule, saved approval or file, so an "Always allow" on a tool's card never allows the Chrome.
- **The sites.** Under a grant with sites, a `session_new` without an allowlist gets them, and a wider or cleared
  allowlist is refused with `CHROME_SCOPE`.

Managed mode is not the person's Chrome and is not gated. Outside jelly nothing is gated.

## The personal-browser binding

`nativeData` is jelly's D103 example, exactly:

```json
[{ "v": 1, "capability": "personal-browser", "view": "browser-native", "read": "browser.status",
   "actions": { "connect": "browser.connect", "stop": "browser.stop" } }]
```

The plugin registers its RPC under the package name, `@joe-broadhead/opencode-browse`:

| Method | Kind | Answer |
| --- | --- | --- |
| `browser.status` | read-only, permission `browse_status` | `{ state, canControl }`, plus `ask` while one waits and `task` while one is allowed |
| `browser.ask` | read-only, the Connect confirmation's `preview` | the ask in words: agent, task, sites |
| `browser.inbox` | read-only, `inbox.method` | `{ items }`: one `request` item, kind `chrome-ask`, per waiting ask |
| `act.browser.connect` | action, `local`, `always` | `true` when it allowed an ask |
| `act.browser.stop` | action, `local`, `always` | `true` |

The states: `unavailable` in managed mode or with no binary; `ready` or `driving` (a call in flight) while a task is
allowed; `not-connected` (or `extension-needed`) with `canControl: true` while an ask waits; otherwise
`not-connected` with `canControl: false`. Each action checks jelly's grant before it changes anything: the host's
Ed25519 key published in the engine, the audience `@joe-broadhead/opencode-browse#engine`, the action, the input's
digest, the minute it is good for, the single-use id, and the `local` class (an owner device).

`browser-native` is a `settings-section` page (`views/browser.html`) with the `rpc` grant for `browser.status` and
`browser.ask`: it shows the state and the ask, and offers Allow for this task and Stop through the two actions, which
jelly confirms.

What jelly has no contract for yet — an ask that reaches the person whatever the agent's access level, the ask and
task words on its own card and strip, Connect naming the ask, Not now, pushed start and end, and ending the task with
jelly's conversation — is on issue #3.

## Home feeds

None.
