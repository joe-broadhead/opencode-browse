# Security

## Supported versions

| OpenCode | Status |
| --- | --- |
| tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6 | supported |
| other 2.2.x | starts; status marks the host untested |
| outside `>=2.2.3 <2.3.0` | status only, with `HOST_UNTESTED`, unless `allowUntestedHost` is true |

## Reporting a vulnerability

Report privately through GitHub's vulnerability reporting on
<https://github.com/joe-broadhead/opencode-browse/security/advisories/new>. Do not open a public issue for a
vulnerability. Please include the plugin version, the OpenCode version, the browse version from `/browse-status`, and
the steps to reproduce.

## Data handling

- **The plugin runs no browser.** It registers browse's MCP server and classifies its tools. Everything the browser
  does goes through that server, its relay and its extension.
- **The binary is pinned and shipped.** Each platform package carries one browse release. The plugin checks the
  binary's SHA-256 against the package's manifest at startup, before it registers the server, and the MCP entry runs a
  wrapper (`bin/mcp.mjs`) that **re-checks the digest at every spawn** and refuses a changed file with
  `BINARY_UNVERIFIED`. browse's own supervision and auto-update are switched off for this entry
  (`OPENCODE_BROWSER_MCP_DIRECT=1`, `OPENCODE_BROWSER_AUTO_UPDATE=off`), so it cannot hand off to another `browse` on
  the machine or replace the pinned file. A file swapped while the plugin is running is caught at the next spawn or
  reload. The plugin never runs `browse install` or `browse update`; managed mode starts `browse pair` to mint its own
  one-time code.
- **The extension is not shipped.** It is installed from the Chrome Web Store by the user, under that listing.
- **No telemetry.** The plugin sends nothing. It reads local state: `browse status --json`, the platform package's
  manifest, and (only when `scope` is set) the vendor CLI's session commands.
- **What the browser handles is the vendor's.** Page content, cookies, stored site secrets, network captures,
  recordings and journals are browse's, on your computer. browse's own documentation describes them; the plugin does
  not copy, log or transmit them. A capture's artifact is real page content: credentials become references, everything
  else stays in clear.

- **The three captures run without asking, by default** (a deliberate default; see below to change it). `network` records authenticated
  request and response headers and bodies from the user's session; `recording` records the tab's pixels and, in
  tab-capture mode, its audio; `flight_recorder` buffers the tab's pixels and saves a clip on request. Each writes to
  a path the agent chooses and stays there until deleted. `README.md` has the recipe to make one ask or turn it off
  for an agent; `docs/scripting.md` repeats it, because a script can start one with no prompt.

- **The relay outlives OpenCode in real mode, by design.** browse daemonises `browse serve` (parent pid 1) so the
  browser stays paired between sessions; it listens on `127.0.0.1:19988` (or `OPENCODE_BROWSER_PORT`) and requires the
  relay token. Stop it with **`/browse-stop-relay`**, which uses browse's own `/shutdown` and refuses a relay on the
  port that this plugin's binary did not start (another browse build, another install). Managed mode stops the relay
  it started on dispose, and never stops a relay that was already running.

- **Recording an agent-opened tab runs ffmpeg.** browse's CDP recorder writes the video through `ffmpeg` on PATH; the
  plugin only checks for it (and reports its version) and never runs it. A lent tab records through the extension's
  tab-capture backend instead, with no external process.

- **Managed mode keeps its own profile.** With `"browser": "managed"`, Chrome for Testing runs with a profile in
  `~/.local/share/opencode-browse/managed`, loaded with the pinned extension unpacked and paired through a one-time
  code written to the extension copy (`relay-pairing.json`, mode 0600) and removed after pairing. Its logins are
  separate from the user's browser: the profile starts signed out of every site. The pinned Chrome for Testing is
  downloaded only by `/browse-install-browser`, verified against `manifest/chromium.json`, and its executable's digest
  is recorded and re-checked on every start.
- **Same-user processes are trusted.** Any process running as you can read the relay token in
  `~/.local/share/browse/relay-token` and drive the browser over CDP. That is inherent to a local relay and to
  `chrome.debugger`; it is not something a plugin can fix.
- **`execute` is not a sandbox.** browse runs agent code in a restricted realm that withholds Node APIs, but the code
  shares the relay's process; the vendor says to treat it as code running as you. The page action can navigate, click,
  type, submit and buy, and one approval covers a whole script.

## Permissions

Every tool is allowed by default. The plugin inserts, directly after each agent's base `* * allow`, a `browse_*` rule
and one rule per known tool by exact name, all `allow` at `access: "all"`, which is the default.

What runs without asking at that default: `browse_execute` runs Playwright code in your signed-in browser (navigation,
clicks, typing, form submits, reading the DOM); the three captures record real page content to a path the agent
chooses; `browse_secrets_run` runs a local command with your stored credentials in its environment; and a tool browse
adds later runs at once on the `browse_*` rule.

To restrict it, set the plugin's `access` option: `"ask-changes"` runs the four reads and tab cleanup and asks for
everything else, and `"read-only"` runs the reads and denies everything else. An agent's own rules, your `permissions`
in `opencode.json` and a saved approval still win, and the tool names are the 18 in `src/browse-tools.ts`. Agents
without a base allow get no rules: inserting the block there would turn a default deny into an ask.

The four captures and their artifacts: a capture's `outputPath` is usually outside the project, so OpenCode asks for
`external_directory` on that folder as well as for the capture's own action. Allow it with
`{ "action": "external_directory", "resource": "/path/to/captures/*", "effect": "allow" }`. A refusal that names
`external_directory` costs nothing, because nothing was written.

The scoped profile (`scope` in the options) denies the session tools that could leave the pinned session or widen it,
and allows `execute` only when the pinned session is read-only, where the relay refuses all input.

An older `opencode-browser` server, if one is still configured, is denied by an exact-name pattern rule
(`opencode_browser_*`) before any of this, so it never runs a browser tool unguarded. A `browse` entry that is not a
browse server is denied the same way.

## Scripts

`browse.tools` runs a method only when the session's agent and session rules resolve to `allow`; an `ask` is refused
with no prompt. The default rules allow every method, so a script runs any of the 18 — including `execute` and the
captures — unless `access` or a rule restricts it; at `"ask-changes"` a change is refused, and at `"read-only"` it is
denied. A `PERMISSION_DENIED` names the method and the next step. A capture that writes outside the project also needs
an `external_directory` allow, because the host asks for it before any file is written. Upstream error text reaches a
script as its first line only, at most 300 characters, with tokens and signed URLs redacted.
