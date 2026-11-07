# Browse for OpenCode

Drive your real Chromium browser from OpenCode — your tabs, logins and extensions — through the browse MCP server
and its extension, with a hand-back for logins, 2FA and payments.

**Unofficial; not affiliated with Anomaly or OpenCode.**

## Requirements

- OpenCode `>=2.2.3 <2.3.0` (tested on 2.2.3, 2.2.4 and 2.2.5).
- macOS (arm64 or x64) or Linux (x64 or arm64, glibc).
- A Chromium-family browser (Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera or Chromium).
- Node.js 22.19 or later, which OpenCode already needs.

The plugin ships the pinned browse binary for your platform, so you do not install browse yourself. The browse
browser extension is installed from the Chrome Web Store, and you pair it once — or let the plugin run a **managed
browser** of its own (below) and install nothing.

## Install

```sh
opencode plugin add @joe-broadhead/opencode-browse
```

Restart OpenCode. Then add the extension and pair it:

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

Every page action runs through `browse_execute`, and it asks first. Reads and tab cleanup run without asking.

**The three captures run without asking, by default (the owner's decision, 2026-11-07).** Read this before you rely on
that default:

- `browse_network` captures **authenticated request and response traffic** from your logged-in session, including
  headers and bodies (credential-bearing fields become references; everything else is in clear). `stop` writes a
  redacted HAR to a path the agent chooses.
- `browse_recording` records **the real tab's pixels**, and the tab's **audio** in tab-capture mode, to a path the
  agent chooses.
- `browse_flight_recorder` keeps a rolling buffer of **the tab's pixels** in memory, and `save_last` writes a clip to a
  path the agent chooses.

Stored where the agent writes them, for as long as you keep the file. A recording or a HAR is real page content: write
it outside the repository, and delete it when you are done. To make one ask, or turn it off, in one agent:

```json
{ "agents": { "build": { "permissions": [
  { "action": "browse_network", "resource": "*", "effect": "ask" },
  { "action": "browse_recording", "resource": "*", "effect": "deny" }
] } } }
```

A script can start a capture with no model turn and no prompt; `docs/scripting.md` repeats this.

## Permissions

The plugin adds these rules to every agent, directly after the agent's base rule that allows everything:

1. `{ "action": "opencode_browser_*", "resource": "*", "effect": "deny" }`: an older browse server, if one is still
   configured, is off by exact-name pattern.
2. `{ "action": "browse_*", "resource": "*", "effect": "deny" }`: a tool browse adds later is **off** until this plugin
   classifies it. A `browse` entry that is not a browse server is denied the same way.
3. One rule per known tool, by exact name, from [`src/browse-tools.ts`](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/src/browse-tools.ts).

| Runs without asking | Asks first | Off |
| --- | --- | --- |
| `browse_status`, `browse_session_list`, `browse_secrets_list`, `browse_secrets_status`, `browse_tabs_cleanup` | `browse_execute`, `browse_session_new`, `browse_session_use`, `browse_session_adopt`, `browse_session_reset`, `browse_session_delete`, `browse_session_allowlist`, `browse_settings` | none of the 18; any tool browse adds later |
| `browse_network`, `browse_recording`, `browse_flight_recorder` (captures) | `browse_secrets_run`, `browse_secrets_refresh` (act with your stored credentials) | |

So **8 run, 10 ask, and a tool this plugin does not know is refused**. Owner decision, 2026-11-07.

Everything later than these rules still wins: an agent's own stricter rules (Plan and Explore cannot drive the
browser), your `permissions` in `opencode.json`, and your saved "Always allow" answers. In an unattended run such as
`opencode run`, a tool that asks is refused, so browser work happens interactively.

To keep one agent to one site, or to inspect only, use the scoped profile below: it denies the session tools that
could leave the pinned session, and `execute` runs only when the session is read-only.

Agents that exist only in your own config, and agents added by plugins that load later, are created after the plugin
adds its rules, so Browse tools run there without asking. `/browse-status` names those agents and shows the default
rules to put first in each one's own `permissions`. Do not put them in the top-level `permissions`, which would loosen
Explore.

## Configure

Options go in the plugin entry in `opencode.json`:

```jsonc
{
  "plugins": [
    {
      "package": "@joe-broadhead/opencode-browse",
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

**Your own binary.** `path` bypasses the platform package. It is reported as unverified (no digest to compare) and
untested (unless it is exactly the pinned version), and a tool it lists that this plugin does not classify stays off.

[Configuration](https://github.com/joe-broadhead/opencode-browse/blob/HEAD/docs/configuration.md) has worked examples,
every error code and the status RPC.

## Organisation rollout

A managed or system config pre-sets the options, so members install the plugin and pair a browser. There is no client
ID or secret to distribute.

```json
{
  "plugins": [
    {
      "package": "@joe-broadhead/opencode-browse",
      "options": { "scope": { "allowedOrigins": ["*.your-company.com"], "readOnly": true } }
    }
  ]
}
```

The paths are `/etc/opencode/opencode.json` on Linux and `/Library/Application Support/opencode/opencode.json` on
macOS.

## Troubleshooting

`/browse-status` shows the binary, the relay, the extension, the scope, the tools and one next step. `/browse-doctor`
runs the vendor's own doctor plus this plugin's checks, and repairs the pinned session.

| State or code | What it means | What to do |
| --- | --- | --- |
| `not configured` | no binary, or no platform package for this computer | reinstall the plugin; on another platform set `path` |
| `failed` | the binary does not match its digest, or a needed command failed | `/browse-doctor`, then reinstall |
| `conflict` | `mcp.servers.browse` in your config is not a browse server | remove or rename that entry, then restart |
| `disabled` | the `browse` server is disabled in `/mcps` | enable it, or remove `"disabled": true` |
| `host untested` | OpenCode is outside the supported range | use `>=2.2.3 <2.3.0`, or set `allowUntestedHost` |
| `BINARY_MISSING` | the platform package is not installed | reinstall the plugin |
| `BINARY_UNVERIFIED` | the binary does not match its pinned SHA-256 | reinstall; set `verifyBinary: false` only if you trust the file |
| `UNSUPPORTED_PLATFORM` | no package ships for this OS or architecture | set `path` to a browse binary you built or installed |
| `SERVER_CONFLICT` | as `conflict` above | remove the entry |
| `SERVER_LEGACY` | an older `opencode-browser` entry is in your config; its tools are denied | remove it; this plugin registers `browse` |
| `SERVER_NOT_REGISTERED` | the server transform failed | restart OpenCode |
| `RULES_NOT_ADDED` | the default rules could not be inserted | restart OpenCode |
| `SCOPE_LOST` | the pinned session is gone or differs | run `/browse-doctor` |
| `SCOPE_UNREACHABLE` | the session could not be created (relay down, CLI error) | pair the browser, then `/browse-doctor` |
| `STATUS_UNAVAILABLE` | `browse status` did not answer | run `browse status` yourself, then press `r` |
| `RELAY_FAILED` | the relay answered with an error rather than a health report | run `/browse-doctor` |
| `DOCTOR_FAILED` | the vendor doctor exited non-zero | read its checks, fix the first failure |
| `HOST_UNTESTED` | as `host untested` above | use a supported OpenCode |
| `OPTIONS_INVALID` | an option failed validation | fix the option the message names |
| `SKILLS_INVALID` | a bundled skill could not load | reinstall the plugin |
| Extension not paired | the browser has no key for this relay | run `browse pair`, enter the code on the options page |
| Relay stopped | nothing has needed the browser yet | ask the agent to open a page, or run `browse status` |
| Protocol incompatible | the extension and binary are from different releases | update the extension in the browser |
| `CHROMIUM_MISSING` / `CHROMIUM_UNSUPPORTED` | managed mode has no browser for this platform or path | run `/browse-install-browser`, or set `chromiumPath` |
| `CHROMIUM_DOWNLOAD_FAILED` / `CHROMIUM_EXTRACT_FAILED` | the Chrome for Testing download or unzip failed | check the network and `unzip`, then run `/browse-install-browser` again |
| `CHROMIUM_UNVERIFIED` | the managed browser changed since it was installed | run `/browse-install-browser` again |
| `CHROMIUM_INVALID` / `CHROMIUM_BRANDED` | `chromiumPath` is not a Chromium, or is branded Chrome | point it at Chromium or Chrome for Testing |
| `EXTENSION_UNVERIFIED` | the bundled extension does not match its pin | reinstall the plugin |

## Uninstall

```sh
opencode plugin remove @joe-broadhead/opencode-browse
```

That removes the plugin, its platform package and its rules; it does not touch your browser. The extension is
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
