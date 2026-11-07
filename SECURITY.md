# Security

## Supported versions

| OpenCode | Status |
| --- | --- |
| 2.2.3, 2.2.4, 2.2.5 | supported and tested |
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

The plugin inserts, directly after each agent's base `* * allow`:

1. `{ "action": "browse_*", "resource": "*", "effect": "deny" }`, so a tool browse adds later is off until this plugin
   classifies it;
2. one rule per known tool, by exact name: 8 `allow`, 10 `ask`, no `deny` among the 18.

A later rule of the agent's, yours in `opencode.json`, or a saved approval still wins. Agents without a base allow get
no rules: inserting the block there would turn a default deny into an ask.

The `ask` tools are the ones that change a page, a session or your settings, or act with your stored credentials:
`browse_execute`, the six session tools, `browse_settings`, `browse_secrets_run` and `browse_secrets_refresh`. The
captures run, and they write real page content to a path the agent chooses.

The scoped profile (`scope` in the options) denies the session tools that could leave the pinned session or widen it,
and allows `execute` only when the pinned session is read-only, where the relay refuses all input.

An older `opencode-browser` server, if one is still configured, is denied by an exact-name pattern rule
(`opencode_browser_*`) before any of this, so it never runs a browser tool unguarded. A `browse` entry that is not a
browse server is denied the same way.

## Scripts

`browse.tools` runs a method only when the session's agent and session rules resolve to `allow`; an `ask` is refused
with no prompt. Under the defaults a script can read status, sessions and secret names, clean up tabs, and capture. It
cannot drive a page, change a session, widen an allowlist, or run a command with your credentials. A
`PERMISSION_DENIED` names the method and the next step. Upstream error text reaches a script as its first line only,
at most 300 characters, with tokens and signed URLs redacted.
