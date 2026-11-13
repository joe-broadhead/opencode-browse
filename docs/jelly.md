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
wraps the executor of every tool the browse server exposes — each `browse_*` id and anything in the `browse`
namespace, classified or not — the one place Code Mode (the model's only way to reach browse) and the `browse.tools`
RPC both pass through. A call from a conversation with no grant never reaches the MCP server.

- **A task** is one OpenCode session (the conversation) and the agent that runs it.
- **The ask.** The first gated call records `{ id, agent, task, origins, mode, at, expiresAt }` — the task is the
  session's title, the origins are the `allowedOrigins` of a `session_new` or `session_allowlist`, else any site —
  and waits for the person until `expiresAt`, five minutes on. A cancelled turn withdraws it. It is also filed once as the `chrome-ask` notice
  (`jelly.core` request, kind `notice`, category `request`), which jelly raises to the agent's people whatever the
  agent's access level, and keeps for the Inbox. It is filed with `keep`, so a host that is away when it is filed
  still raises it once it reads the pending requests.
- **The mode, enforced.** The call that asks states the mode: a tool of the `read` class in the plugin's own table
  (`status`, `session_list`, `secrets_list`, `secrets_status`) asks to `read`; any other tool, and any tool the table
  does not classify, asks to `act`. Under a `read` grant only those four pass; an act call there never reaches the
  server: it asks again, for `act`, riding along on the task, and waits. Allowed, the same task acts; Not now leaves
  it reading. browse has no separate navigate, snapshot or screenshot tool — they are `execute`, which can click and
  type — so a read grant cannot open or read a page. A read-only browse session (`session_new` with `readOnly`) refuses
  input, not page script, so it is not counted as read.
- **More than one task.** While a task holds the Chrome, Stop always stays reachable: the read keeps that task's
  state and adds a second conversation's or a subagent's waiting ask as `ask`. That ask reaches the person through
  the notice, the Inbox and the plugin's page, which allows it by its id; unanswered, it ends at `expiresAt` as
  Not now.
- **Allow for this task** is `browser.allow { id }` (B3), or jelly's Connect (`browser.connect`), which allows the ask
  named by `input.ask`, or the oldest one when jelly sends `{}`, until jelly draws `asking`. **Not now** is
  `browser.decline { id }`. With no ask pending the read reports `canControl: false`, so jelly offers no Connect and
  the Chrome cannot be allowed in advance.
- **The end.** The agent's `session_reset` or `session_delete` in that conversation, `browser.stop` (all, or one
  `session`), the conversation deleted or archived, an hour with no browse call, or the engine stopping. A call
  still running is aborted with the grant and fails with `CHROME_NOT_ALLOWED`. Nothing is
  written: no rule, saved approval or file, so an "Always allow" on a tool's card never allows the Chrome.
- **The sites.** Under a grant with sites, a `session_new` without an allowlist gets them, and a wider or cleared
  allowlist is refused with `CHROME_SCOPE`.

Managed mode is not the person's Chrome and is not gated. Outside jelly nothing is gated.

## The personal-browser binding

jelly's asks B1–B4 (issue #5), checked against jelly at `99cd657c4`. `nativeData` is jelly's D103 example, exactly
(B1); its `actions` object is strict in jelly's schema, so it names connect and stop only:

```json
[{ "v": 1, "capability": "personal-browser", "view": "browser-native", "read": "browser.status",
   "actions": { "connect": "browser.connect", "stop": "browser.stop" } }]
```

The plugin registers its RPC under the package name, `@joe-broadhead/opencode-browse`:

| Method | Kind | Answer |
| --- | --- | --- |
| `browser.status` | read-only, permission `browse_status` | `{ state, canControl, task?, agent?, request? }` (B2, B3) |
| `browser.ask` | read-only, the confirmations' `preview` | the ask in words: agent, mode, task, sites |
| `browser.inbox` | read-only, `inbox.method` | `{ items }`: one `request` item, kind `chrome-ask`, per waiting ask |
| `act.browser.connect` | action, `local`, `always` | `true` when it allowed an ask |
| `act.browser.allow` | action, `local`, `always`, input `{ id }` | `true`; `REQUEST_EXPIRED` or `NOT_YOUR_REQUEST` |
| `act.browser.decline` | action, `local`, `always`, input `{ id }` | `true`; `REQUEST_EXPIRED` or `NOT_YOUR_REQUEST` |
| `act.browser.stop` | action, `local`, `always` | `true` |

The read (B2): `task` is `{ id, title, startedAt }` while `driving` (the plugin never reports `needs-you`), with
`id` the grant's own id and `title` the conversation's; `agent` is the id of the agent holding the session, while a
task is allowed. `request` (B3) is `{ id, agent, task: { title }, scope: { sites, mode }, expiresAt }`, where
`sites: ["*"]` means any site. No other field is reported.

The states: `unavailable` in managed mode or with no binary; `ready` or `driving` (a call in flight) with
`canControl: true` while a task is allowed, with a new `request` riding along, so jelly keeps offering Stop; with no
task and a request waiting, `asking` — reported as `not-connected` (or `extension-needed`) until jelly draws
`asking`, because jelly at `99cd657c4` reads an unknown state as unavailable with neither Connect nor Stop (one
constant, `ASKING_STATE`, in `src/jelly/native.ts`); with neither, `ready` with `canControl: false`, so the next
read after a task ends is `ready`, never `driving` on a stale allow — or `extension-needed` with `canControl: false`
when the running relay reports the extension not connected (a relay that is not running starts on demand, so it
does not make the read `extension-needed`). `REQUEST_EXPIRED` answers an id in the plugin's form
(`ask_` and 24 hex) that is not waiting: answered, withdrawn, run out, or no longer known after an engine restart —
the engine cannot tell them apart, and the next step is the same. `NOT_YOUR_REQUEST` answers only an id the plugin
could never have issued. The page offers Allow for this task, Not now and Stop whenever each
applies. Each action checks jelly's grant before it changes anything: the host's
Ed25519 key published in the engine, the audience `@joe-broadhead/opencode-browse#engine`, the action, the input's
digest, the minute it is good for, the single-use id, and the `local` class the actions declare (jelly's host is what
refuses a `local` action from a paired device).

`browser-native` is a `settings-section` page (`views/browser.html`) with the `rpc` grant for `browser.status` and
`browser.ask`: it shows the state and the request, and offers Allow for this task, Not now and Stop through the
actions, which jelly confirms.

`notices` declares two. `chrome-ask` (label "Your Chrome", category `request`, preview `line`) is the ask itself,
naming the agent, the task, the sites and the mode, so the person sees it whatever the agent's access level.
`personal-browser` (B4) is the change signal: filed with no name and no line, keyed per change, not kept, each time the
read's answer changes, so jelly reads again at once. The two stay separate because the ask must carry words to the
person and the signal must carry none. jelly's notice schema at `99cd657c4` has no `browser` category and requires a
label and a preview, so `personal-browser` is declared as `request` with the `count` preview; raised there, each change
would be a banner (one per browse call, as `driving` comes and goes), so it is raised only once
`RAISE_CHANGE_NOTICES` in `src/jelly/native.ts` is true, when jelly treats the notice as a signal to read. What jelly
has no contract for yet — Allow and Not now on jelly's own card, the hint's `actions` growing `allow` and `decline`,
and ending the task with jelly's conversation — is on issues #3 and #5.

## Home feeds

None.
