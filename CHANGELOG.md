# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- In jelly, the person's Chrome per task (issue #3): under jelly, in real mode, every browse tool waits behind a gate
  until the person allows their Chrome for that one task; nothing reaches the relay, the extension or the browser
  before. The grant is held in memory for one conversation and agent, and ends with the agent's `session_reset` or
  `session_delete`, the person's Stop, the conversation being deleted or archived, an hour idle, or the engine
  stopping. Under a grant with sites, a wider allowlist is refused. New codes `CHROME_NOT_ALLOWED` and
  `CHROME_SCOPE`.
- jelly's `personal-browser` binding (D103): the `browser-native` page view, the read-only `browser.status`,
  `browser.ask` and `browser.inbox` methods under the package's own RPC id, the `browser.connect` and `browser.stop`
  actions (owner device, confirmed every time, checked against jelly's signed action grant), and an Inbox item for a
  pending ask, also filed as jelly's `chrome-ask` notice. The gate covers every tool the browse server exposes,
  classified or not; while a task holds the Chrome, Stop stays offered and a second conversation's ask is allowed
  from the plugin's page; and Stop, the task's end and the idle limit abort a browse call already running.
- jelly's asks B1–B4 (issue #5). The `browser.status` read answers jelly's shape, `{ state, canControl, task?: { id,
  title, startedAt }, agent?, request? }`, and no other field. A waiting request is `request: { id, agent, task: {
  title }, scope: { sites, mode }, expiresAt }`; with no task holding the Chrome its state is `asking` once jelly
  draws it (`not-connected` until then, so jelly's Connect still allows it), and while a task holds the Chrome the
  state stays `ready` or `driving` so Stop stays reachable. New actions `browser.allow { id }` and
  `browser.decline { id }` (owner device, confirmed every time), with the codes `REQUEST_EXPIRED` and
  `NOT_YOUR_REQUEST`. The `personal-browser` change signal (B4) is built behind `RAISE_CHANGE_NOTICES`, neither
  raised nor declared until jelly treats it as a signal to read.
- The `jelly` settings declare their choices: `access` is drawn as Allowed, Ask before changes or Read only, with
  jelly's own line for each, and the `browser` option is declared as Your browser (`real`) or Separate browser
  (`managed`) (needs a jelly that includes app#1301).

### Changed

- In jelly, a request's mode is enforced: a read grant lets only the four reads of the plugin's table through
  (`status`, `session_list`, `secrets_list`, `secrets_status`), and any other or unclassified tool asks again, to act.
  The person reads a read ask as "to check your Chrome's status only; it can't open or read pages", since browse
  opens and reads pages only through `execute`.
- In jelly, with no task and no request the read is `ready` with `canControl: false` (it was `not-connected`), so the
  read after a task ends is `ready`; it is `extension-needed` instead when the running relay reports the extension
  not connected. The read no longer reports `ask`, or `task` as `{ agent, task, origins, since }`.

## [0.0.0] - 2026-11-10
<!-- kit-release: the GitHub release v0.0.0 -->

### Added

- The `browse` MCP server, registered at runtime with the pinned browse `0.0.15` binary and adopted from a user's own
  entry when it is a browse command.
- The pinned browse binary, downloaded on first use from this repository's release (`browse-<platform>.gz`), with its
  `manifest/browse.json` digest and browse's MIT licence; the plugin verifies the digest before running it, and
  `/browse-install` downloads it on request.
- A Jelly `access` setting, with `all`, `ask-changes` and `read-only`, as the other plugins declare it.
- Default permission rules by exact tool name: every one of the 18 allows, and so does the `browse_*` pattern, so a tool
  browse adds later runs at once. Switching a project into or out of the scoped profile replaces the previous block in
  the deciding position.
- An opt-in scoped profile that pins the server to one browse session, read-only and/or limited to allowed origins,
  and denies the session tools that could leave it.
- `/browse-status`, the `/browse` dialog, the `browse/status` RPC and `/browse-doctor`, with the family's shared status
  fields and one next step.
- The `browse.tools` RPC (v2.1), one method per known tool with its class.
- The `browse` and `browse-capture` skills, and the Jelly declaration.
- `npm run drift`, which compares the table with the pinned release's `tools/list` or with a binary you point it at.
- An opt-in managed browser (`"browser": "managed"`): Chrome for Testing in its own profile, browse's pinned extension
  loaded unpacked and paired automatically, headed or headless, stopped on dispose. `/browse-install-browser`
  downloads and verifies CfT on demand; `chromiumPath` uses a Chromium you already have.
- `bin/mcp.mjs`, the MCP entry: it re-verifies the pinned binary at every spawn and serves it with browse's
  supervision and auto-update off, so no other `browse` on the machine is ever run.
- The plugin runs on OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.
- A conflicting `browse` entry, which is not this plugin's server, is denied by exact name so it cannot run unguarded.
- Recording readiness in `/browse-status`, `/browse-doctor` and the status RPC: `ffmpeg` on PATH with its version for
  agent-opened tabs, the toolbar-click backend for a lent tab, and one next step when `ffmpeg` is missing.
- A caller-isolation probe in `npm run drift`: two `_meta` session ids against the pinned binary, reported as
  `isolates: yes|no` and never a failure.
- One typed code table in `src/constants.ts`, with a test that checks every raise site against it, both docs tables
  against it, and rejects a hand-written `"CODE: message"` string.

### Changed

- Every tool is now allowed by default: the plugin inserts one `allow` rule for each of the 18 tools and one for the
  `browse_*` pattern, directly after each agent's base rule, so page actions, session changes, settings, the captures
  and `secrets_run` run without a prompt, and a tool browse adds later runs at once. An agent's own rules, your
  `permissions` and a saved approval still win.
- The `access` option restricts that in one line: `"all"` (the default), `"ask-changes"` (the reads and tab cleanup
  run, everything else asks) and `"read-only"` (the reads run, everything else is denied). The README prints the block
  for each value, and `/browse-status` shows the one in force.
- The pinned browse binary moves to `0.0.15`; the tool table is unchanged, and `npm run drift` reports `same`
  against the new release.

### Fixed

- `/browse-stop-relay` stops the relay this plugin's binary started, through browse's own `/shutdown`, and refuses a
  relay on the port that is not ours (another browse build, or `managed` false). The docs name it, since a user of this
  plugin has no `browse` on PATH.
- Managed mode stops the relay it started when the plugin is disposed, through browse's own `/shutdown`, and never
  stops a relay that was already running. Real mode leaves browse's relay running, as browse does, and the docs say so.
- Tests and scripts run the pinned binary only with an isolated HOME, XDG dirs and a free port (never browse's default
  19988), and fail if a `browse serve` for that HOME outlives them.
- `bin/mcp.mjs` caches the verified digest by file identity (device, inode, size, mtime and ctime) in the plugin data
  directory, mode 0600, and re-hashes in full on any difference; the pin's digest stays the reference. A warm spawn
  skips about 107 ms of hashing on the 110 MiB binary, and a changed byte is still refused with `BINARY_UNVERIFIED` and
  exit 78, even after the mtime is put back.
- The README states the 0.0.15 limitation: parallel agents share one browse session until each task creates its own,
  and browse `0.0.16` will isolate callers when the plugin re-pins to it.
