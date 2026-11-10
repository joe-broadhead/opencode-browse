# Browse for OpenCode

Drive your real Chromium browser from OpenCode — your tabs, logins and extensions — through the browse MCP server
and its extension, with a hand-back for logins, 2FA and payments.

**Unofficial; not affiliated with Anomaly or OpenCode.**

## Requirements

- OpenCode `>=2.2.3 <2.3.0` (tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6).
- macOS (arm64 or x64) or Linux (x64 or arm64, glibc).
- A Chromium-family browser (Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera or Chromium).
- Node.js 22.19 or later, which OpenCode already needs.

The plugin ships the pinned browse binary for your platform, so you do not install browse yourself. The browse
browser extension is installed from the Chrome Web Store, and you pair it once — or let the plugin run a **managed
browser** of its own (below) and install nothing.

## Install

```sh
opencode plugin add github:joe-broadhead/opencode-browse#v0.0.0
```

The binary is downloaded from this plugin's release on first use, and only at `access: "all"`, the default. Setup downloads it, checks it against its pinned SHA-256, and then registers the server. At `"ask-changes"` or `"read-only"` setup downloads nothing: it names `/browse-install`, which downloads and verifies the binary at any `access` value. Run it, then restart OpenCode, so the server registers.

Restart OpenCode. Then add the extension and pair it:

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-browse#v0.0.0`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-browse#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-browse#v0.0.0" }] }
```

1. Install **browse** from the Chrome Web Store and open its options page.
2. Ask OpenCode to run `/browse-doctor`; it prints the pairing command and the state of the relay, the extension and
   the pinned session.
3. Run the `Pair:` command `/browse-doctor` prints (the plugin's own binary, with the full path), enter the code on
   the extension's options page, and click **Pair**.

There is nothing to sign in to: no account, no OAuth, no `/connect` entry. Pairing is between your browser and the
relay on your computer.

## Managed browser (optional)

Set `"browser": "managed"` and the plugin runs a **separate Chromium** — Chrome for Testing, downloaded on demand —
with **its own profile** in the plugin's data folder and browse's extension loaded unpacked and paired automatically.
Nothing is installed in your own browser, and **its logins are separate**: the managed profile starts signed out of
every site, so a task that needs your accounts belongs in the real browser.

```jsonc
{ "options": { "browser": "managed", "headless": false } }
```

- Headed by default, so you can watch; `"headless": true` runs it without a window.
- Run `/browse-install-browser` to download and verify the pinned Chrome for Testing (about 150–210 MB) and start it.
  The plugin never downloads it on its own, and a digest mismatch is refused.
- `"chromiumPath": "/path/to/chrome"` uses a Chromium or Chrome for Testing you already have instead; branded Google
  Chrome is refused, because it will not load a preloaded unpacked extension.
- The browser stops when the plugin is disposed (a reload or exit); a profile lock left by a crash is cleared on the
  next start, and a browser a previous run left behind is stopped only when its command line names the executable this
  plugin launched.
- Permissions and the scoped profile are unchanged.

## Use

Ask for browser work the way you would a person:

> Open news.ycombinator.com in my browser and tell me the top story.

> In my signed-in GitHub, find the pull request that touched `src/auth.ts` last week and summarise its review comments.

> Record a short demo of the checkout flow on staging, saved outside the repo.

The agent opens its own background tabs in a collapsed group, works with Playwright, and hands the tab back when only
you can continue: a login, 2FA, a passkey, a captcha or a payment. Only a real click on the card's **Continue**, or on
the toolbar button, resumes the script.

Every page action runs through `browse_execute`, and by default it runs without asking. The reads, tab cleanup and the
captures do too; the `access` option below is how you restrict any of them.

**The three captures run without asking, by default.** This is a deliberate default; read this before you rely on
that default:

- `browse_network` captures **authenticated request and response traffic** from your logged-in session, including
  headers and bodies (credential-bearing fields become references; everything else is in clear). `stop` writes a
  redacted HAR to a path the agent chooses.
- `browse_recording` records **the real tab's pixels**, and the tab's **audio** in tab-capture mode, to a path the
  agent chooses.
- `browse_flight_recorder` keeps a rolling buffer of **the tab's pixels** in memory, and `save_last` writes a clip to a
  path the agent chooses.

Stored where the agent writes them, for as long as you keep the file. A recording or a HAR is real page content: write
it outside the repository, and delete it when you are done.

A capture's `outputPath` is usually outside the project, so OpenCode asks for `external_directory` on that folder as
well as for the capture's own action. Allow it once to stop the second prompt, or keep the folder inside the project:

```json
{ "permissions": [{ "action": "external_directory", "resource": "/path/to/captures/*", "effect": "allow" }] }
```

A refusal that names `external_directory` costs nothing: nothing was written. To make one capture ask, or turn it off,
in one agent:

```json
{ "agents": { "build": { "permissions": [
  { "action": "browse_network", "resource": "*", "effect": "ask" },
  { "action": "browse_recording", "resource": "*", "effect": "deny" }
] } } }
```

A script can start a capture with no model turn and no prompt; `docs/scripting.md` repeats this.

**Recording readiness.** `browse_recording` and `browse_flight_recorder` record an agent-opened tab through CDP, which
needs `ffmpeg` on PATH. A tab you lend with the toolbar button records through the extension's tab-capture backend and
needs nothing. `/browse-status`, `/browse-doctor` and the status RPC show both backends; when `ffmpeg` is missing the
next step is `brew install ffmpeg` (or your package manager's), or lend a tab and record that.

## Permissions

**Every tool is allowed by default.** The plugin adds this block to every agent, directly after the agent's base rule
that allows everything. `access: "all"` is the default, so this is the block in force:

<!-- rules:all -->
```json
[
  {"action": "browse_*", "resource": "*", "effect": "allow"},
  {"action": "browse_status", "resource": "*", "effect": "allow"},
  {"action": "browse_session_list", "resource": "*", "effect": "allow"},
  {"action": "browse_secrets_list", "resource": "*", "effect": "allow"},
  {"action": "browse_secrets_status", "resource": "*", "effect": "allow"},
  {"action": "browse_tabs_cleanup", "resource": "*", "effect": "allow"},
  {"action": "browse_execute", "resource": "*", "effect": "allow"},
  {"action": "browse_session_new", "resource": "*", "effect": "allow"},
  {"action": "browse_session_use", "resource": "*", "effect": "allow"},
  {"action": "browse_session_adopt", "resource": "*", "effect": "allow"},
  {"action": "browse_session_reset", "resource": "*", "effect": "allow"},
  {"action": "browse_session_delete", "resource": "*", "effect": "allow"},
  {"action": "browse_settings", "resource": "*", "effect": "allow"},
  {"action": "browse_network", "resource": "*", "effect": "allow"},
  {"action": "browse_recording", "resource": "*", "effect": "allow"},
  {"action": "browse_flight_recorder", "resource": "*", "effect": "allow"},
  {"action": "browse_secrets_run", "resource": "*", "effect": "allow"},
  {"action": "browse_secrets_refresh", "resource": "*", "effect": "allow"},
  {"action": "browse_session_allowlist", "resource": "*", "effect": "allow"}
]
```
<!-- /rules:all -->

With `access: "ask-changes"`, the reads and tab cleanup still run and everything else asks. That is the block for it:

<!-- rules:ask-changes -->
```json
[
  {"action": "browse_*", "resource": "*", "effect": "ask"},
  {"action": "browse_status", "resource": "*", "effect": "allow"},
  {"action": "browse_session_list", "resource": "*", "effect": "allow"},
  {"action": "browse_secrets_list", "resource": "*", "effect": "allow"},
  {"action": "browse_secrets_status", "resource": "*", "effect": "allow"},
  {"action": "browse_tabs_cleanup", "resource": "*", "effect": "ask"},
  {"action": "browse_execute", "resource": "*", "effect": "ask"},
  {"action": "browse_session_new", "resource": "*", "effect": "ask"},
  {"action": "browse_session_use", "resource": "*", "effect": "ask"},
  {"action": "browse_session_adopt", "resource": "*", "effect": "ask"},
  {"action": "browse_session_reset", "resource": "*", "effect": "ask"},
  {"action": "browse_session_delete", "resource": "*", "effect": "ask"},
  {"action": "browse_settings", "resource": "*", "effect": "ask"},
  {"action": "browse_network", "resource": "*", "effect": "ask"},
  {"action": "browse_recording", "resource": "*", "effect": "ask"},
  {"action": "browse_flight_recorder", "resource": "*", "effect": "ask"},
  {"action": "browse_secrets_run", "resource": "*", "effect": "ask"},
  {"action": "browse_secrets_refresh", "resource": "*", "effect": "ask"},
  {"action": "browse_session_allowlist", "resource": "*", "effect": "ask"}
]
```
<!-- /rules:ask-changes -->

With `access: "read-only"`, the reads still run and everything else is denied:

<!-- rules:read-only -->
```json
[
  {"action": "browse_*", "resource": "*", "effect": "deny"},
  {"action": "browse_status", "resource": "*", "effect": "allow"},
  {"action": "browse_session_list", "resource": "*", "effect": "allow"},
  {"action": "browse_secrets_list", "resource": "*", "effect": "allow"},
  {"action": "browse_secrets_status", "resource": "*", "effect": "allow"},
  {"action": "browse_tabs_cleanup", "resource": "*", "effect": "deny"},
  {"action": "browse_execute", "resource": "*", "effect": "deny"},
  {"action": "browse_session_new", "resource": "*", "effect": "deny"},
  {"action": "browse_session_use", "resource": "*", "effect": "deny"},
  {"action": "browse_session_adopt", "resource": "*", "effect": "deny"},
  {"action": "browse_session_reset", "resource": "*", "effect": "deny"},
  {"action": "browse_session_delete", "resource": "*", "effect": "deny"},
  {"action": "browse_settings", "resource": "*", "effect": "deny"},
  {"action": "browse_network", "resource": "*", "effect": "deny"},
  {"action": "browse_recording", "resource": "*", "effect": "deny"},
  {"action": "browse_flight_recorder", "resource": "*", "effect": "deny"},
  {"action": "browse_secrets_run", "resource": "*", "effect": "deny"},
  {"action": "browse_secrets_refresh", "resource": "*", "effect": "deny"},
  {"action": "browse_session_allowlist", "resource": "*", "effect": "deny"}
]
```
<!-- /rules:read-only -->

That means page actions run in your real browser, the three captures run, and `browse_secrets_run` can run a local
command with your stored credentials — all without a prompt. Nothing is off, and a tool browse adds later runs too.

To restrict, choose one of three:

1. **`access`**, one option for the plugin: `"all"` (the default), `"ask-changes"` (the four reads run, everything else
   asks) or `"read-only"` (the four reads run, everything else is denied).
2. **An agent's own rules**, such as a read-only agent:
   `"permissions": [{ "action": "browse_*", "resource": "*", "effect": "deny" }, { "action": "browse_status", "resource": "*", "effect": "allow" }]`.
3. **A per-tool rule** in your `opencode.json`: `{ "action": "browse_execute", "resource": "*", "effect": "ask" }`, or
   `"deny"` to turn one tool off. The tool names are the 18 in
   [`src/browse-tools.ts`](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/src/browse-tools.ts).

Everything later than these rules still wins: an agent's own stricter rules (Plan and Explore cannot drive the
browser), your `permissions` in `opencode.json`, and your saved "Always allow" answers.

To keep one agent to one site, or to inspect only, use the scoped profile below: it denies the session tools that
could leave the pinned session, and `execute` runs only when the session is read-only. That is a restriction you turn
on, so it stays a deny whatever `access` says.

Agents that exist only in your own config, and agents added by plugins that load later, are created after the plugin
adds its rules, so Browse tools run there without asking. `/browse-status` names those agents and shows the block for
the access value in force to put first in each one's own `permissions`. Do not put it in the top-level `permissions`,
which would loosen Explore.

## Configure

Options go in the plugin entry in `opencode.json`:

```jsonc
{
  "plugins": [
    {
      "package": "github:joe-broadhead/opencode-browse#v0.0.0",
      "options": {
        // Pin the server to one browse session on these sites. Optional.
        "scope": { "session": "opencode", "allowedOrigins": ["github.com", "*.githubusercontent.com"], "readOnly": false },
        // Check the pinned binary's SHA-256 before running it. On by default.
        "verifyBinary": true
        // Use your own browse binary instead of the pinned one. Reported unverified and untested.
        // "path": "/Users/you/.local/bin/browse",
        // Run on an OpenCode version outside the supported range, with a warning in status.
        // "allowUntestedHost": false
      }
    }
  ]
}
```

**Scoped mode.** With `scope` set, the plugin creates (or repairs) that session at setup, pins the MCP server to it
with `OPENCODE_BROWSER_SESSION`, and adds a stricter rule set: `session_new`, `session_use`, `session_adopt`,
`session_delete` and `session_allowlist` are denied, so the agent cannot create an unrestricted session or adopt your
tab. `execute` runs without asking when `readOnly` is true, because the relay refuses all input in a read-only
session, and asks otherwise. `/browse-doctor` re-applies the scope if the session is deleted or widened.

**Your own binary.** `path` bypasses the release binary. It is reported as unverified (no digest to compare) and
untested (unless it is exactly the pinned version). A tool it lists that this plugin does not classify follows the `access` option, like every other tool.

[Configuration](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/docs/configuration.md) has worked examples,
every error code and the status RPC.

## Organisation rollout

A managed or system config pre-sets the options, so members install the plugin and pair a browser. There is no client
ID or secret to distribute.

```json
{
  "plugins": [
    {
      "package": "github:joe-broadhead/opencode-browse#v0.0.0",
      "options": { "scope": { "allowedOrigins": ["*.your-company.com"], "readOnly": true } }
    }
  ]
}
```

The paths are `/etc/opencode/opencode.json` on Linux and `/Library/Application Support/opencode/opencode.json` on
macOS.

## Known limits

- **Parallel agents share one browse session.** This plugin pins browse `0.0.15`, whose build predates per-caller sessions
  (browse commit `f66dce2`). OpenCode does send each agent's session id with every browse call, and the wrapper forwards
  it, but `0.0.15` uses one current session for all of them: two agents working at the same time share one session and
  its tab set. Each task must start its own: call `browse_session_new` with a name for the task at the start, pass its id
  as `session` on later calls, and call `browse_session_delete` when the task is done. `skills/browse/SKILL.md` tells the
  agent this. browse `0.0.16` keeps a session per caller, and this plugin will re-pin to it when it is released. Until
  then, `npm run drift` prints `isolates: no`; that line is information, not a failure.
- The browse binary downloads at setup only at `access: "all"`, because the server registers at setup and cannot ask at a tool call. At `"ask-changes"` or `"read-only"`, run `/browse-install`, then restart OpenCode.
- Updates are not automatic for a Git install, and `opencode plugin update` and `opencode plugin check` do not work on one: to move to a newer release, remove the old entry and add the new tag.

## Troubleshooting

`/browse-status` shows the binary, the relay, the extension, the scope, the tools and one next step. `/browse-doctor`
runs the vendor's own doctor plus this plugin's checks, and repairs the pinned session.

| State or code | What it means | What to do |
| --- | --- | --- |
| `not configured` | no binary yet, or no release build for this computer | run `/browse-install`, then restart OpenCode; on another platform set `path` |
| `failed` | the binary does not match its digest, or a needed command failed | `/browse-doctor`, then reinstall |
| `conflict` | `mcp.servers.browse` in your config is not a browse server | remove or rename that entry, then restart |
| `disabled` | the `browse` server is disabled in `/mcps` | enable it, or remove `"disabled": true` |
| `host untested` | OpenCode is outside the supported range | use `>=2.2.3 <2.3.0`, or set `allowUntestedHost` |
| `BINARY_MISSING` | the release binary is not installed yet | run `/browse-install`, then restart OpenCode |
| `NOT_INSTALLED` | `/browse-stop-relay` has no pinned binary to identify the relay | reinstall the plugin |
| `BINARY_UNVERIFIED` | the binary does not match its pinned SHA-256 | reinstall; set `verifyBinary: false` only if you trust the file |
| `UNSUPPORTED_PLATFORM` | no package ships for this OS or architecture | set `path` to a browse binary you built or installed |
| `SERVER_LEGACY` | an older `opencode-browser` entry is in your config; its tools are denied | remove it; this plugin registers `browse` |
| `SERVER_NOT_REGISTERED` | the server transform failed | restart OpenCode |
| `RULES_NOT_ADDED` | the default rules could not be inserted | restart OpenCode |
| `SCOPE_LOST` | the pinned session is gone or differs | run `/browse-doctor` |
| `SCOPE_UNREACHABLE` | the session could not be created (relay down, CLI error) | pair the browser, then `/browse-doctor` |
| `STATUS_UNAVAILABLE` | `browse status` did not answer | run `browse status` yourself, then press `r` |
| `RELAY_FAILED` | the relay answered with an error rather than a health report | run `/browse-doctor` |
| `RELAY_NOT_OURS` | the relay on the port was not started by this plugin's binary (another build, another install) | leave it, or stop it with the browse install that started it |
| `RELAY_STOP_FAILED` | the relay accepted the shutdown request but did not stop | run `/browse-doctor` |
| `DOCTOR_FAILED` | the vendor doctor exited non-zero | read its checks, fix the first failure |
| `HOST_UNTESTED` | as `host untested` above | use a supported OpenCode |
| `OPTIONS_INVALID` | an option failed validation | fix the option the message names |
| `SKILLS_INVALID` | a bundled skill could not load | reinstall the plugin |
| Extension not paired | the browser has no key for this relay | run `browse pair`, enter the code on the options page |
| Relay stopped | nothing has needed the browser yet | ask the agent to open a page, or run `browse status` |
| Relay still running after OpenCode exits | real mode keeps it, so the browser stays paired (browse's design) | run `/browse-stop-relay`; it stops only the relay this plugin's binary started |
| Protocol incompatible | the extension and binary are from different releases | update the extension in the browser |
| `CHROMIUM_MISSING` | managed mode has no browser for this platform or path | run `/browse-install-browser`, or set `chromiumPath` |
| `CHROMIUM_UNSUPPORTED` | managed mode has no Chrome for Testing build for this platform | set `chromiumPath`, or use the real browser |
| `CHROMIUM_DOWNLOAD_FAILED` | the Chrome for Testing download failed | check the network, then run `/browse-install-browser` again |
| `CHROMIUM_EXTRACT_FAILED` | the Chrome for Testing download did not unzip | check `unzip`, then run `/browse-install-browser` again |
| `CHROMIUM_UNVERIFIED` | the managed browser changed since it was installed | run `/browse-install-browser` again |
| `CHROMIUM_INVALID` | `chromiumPath` is not a Chromium or Chrome for Testing binary | point it at one |
| `CHROMIUM_BRANDED` | `chromiumPath` is branded Google Chrome, which will not load the unpacked extension | point it at Chromium or Chrome for Testing |
| `CHROMIUM_INSTALL_FAILED` | `/browse-install-browser` failed before or during the install | run `/browse-doctor` and fix the first failed check |
| `EXTENSION_UNVERIFIED` | the bundled extension does not match its pin | reinstall the plugin |
| Recording needs ffmpeg | an agent-opened tab records through CDP, which needs `ffmpeg` on PATH | `brew install ffmpeg`, or click the toolbar button on a tab and record that |

## Uninstall

```sh
opencode plugin remove github:joe-broadhead/opencode-browse#v0.0.0
```

That removes the plugin, its cached binary and its rules; it does not touch your browser. The extension is
uninstalled from your browser's extensions page. Managed mode's profile and Chrome for Testing are in
`~/.local/share/opencode-browse/managed` and `~/.cache/opencode-browse`; delete those folders to remove them. If you also ran the vendor's installer in the past, `browse uninstall`
removes the files it left behind.

## Links

- [Architecture](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/docs/architecture.md)
- [Configuration](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/docs/configuration.md)
- [Scripts](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/docs/scripting.md)
- [Jelly](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/docs/jelly.md)
- [Security](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/SECURITY.md)
- [Changelog](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/CHANGELOG.md)
- [browse](https://github.com/anomalyco/browse), the upstream project
