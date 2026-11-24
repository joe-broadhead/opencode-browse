# Browse plugin

Drive the user's own signed-in Chromium browser from OpenCode, through the browse MCP server and its extension:
their tabs, logins and 2FA, with a hand-back for logins, captchas and payments.

**Unofficial; not affiliated with Anomaly or OpenCode.**

browse is a trademark of Anomaly Innovations, Inc.; this unofficial plugin is not endorsed by them.

## Requirements

- OpenCode `>=2.4.1 <2.5.0` (tested on 2.4.1).
- macOS (arm64 or x64) or Linux (x64 or arm64, glibc).
- A Chromium-family browser (Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera or Chromium).
- Node.js 22.19 or later, which OpenCode already needs.

The plugin ships the pinned browse binary for your platform, so you do not install browse yourself. The browse
browser extension is installed from the Chrome Web Store and paired once — or the plugin runs a **managed browser** of
its own, with nothing installed in your browser.

## Install

Install from a release:

```sh
opencode plugin add github:we-the-rebel-alliance/browse-plugin#v<version>
```

The first release on plugin-contract is v0.0.0 (phase 4b).

The plugin is installed from Git, not npm, and a release install does not update itself: remove the entry and add the
new release's tag.

The binary is downloaded on first use, at `access: "all"` (the default). Setup verifies it against its pinned SHA-256
and then registers the server. At `"ask-changes"` or `"read-only"` setup downloads nothing: run `/browse-install`, which
downloads and verifies the binary at any access value, then restart OpenCode.

Restart OpenCode, then pair the extension:

1. Install **browse** from the Chrome Web Store and open its options page.
2. Run `/browse-doctor`; it prints the pairing command and the state of the relay, the extension and the session.
3. Run the `Pair:` command it prints, enter the code on the extension's options page, and click **Pair**.

There is nothing to sign in to: no account, no OAuth, no `/connect` entry.

## What it does

The plugin registers the pinned browse binary as the local `browse` MCP server, so the model and Code Mode see
browse's 18 tools under `tools.browse.*` (the direct tools are `browse_status`, `browse_execute` and the rest). It
classifies every tool, adds its default permission rules to each agent, reports status, and ships two skills
(`skills/browse` and `skills/browse-capture`):

- **browse** — when to use the user's browser, the session tools, the permission model, hand-back and credentials.
- **browse-capture** — network captures, recordings and the flight recorder.

Except in managed mode, the plugin never runs a browser itself, never edits a config file, and never runs `browse
install` or `browse update`. Managed mode starts its own pinned Chromium in its own profile and pairs the extension with
`browse pair`.

## The pinned binary

`manifest/browse.json` pins one browse release per platform: tarball URL, size, SHA-256 and the extracted binary's
SHA-256. The release files are built by the `native` workflow and attached to the plugin release. A binary is
resolved from the installed package's cache, verified against the pin at startup, and the MCP entry (`bin/mcp.mjs`)
**re-checks the digest at every spawn**. A `path` option uses your own binary instead; it is reported unverified, and
untested unless it is exactly the pinned version.

## Managed browser (optional)

Set `"browser": "managed"` and the plugin runs a separate Chromium — Chrome for Testing, downloaded on demand — with
its own profile and browse's extension loaded unpacked and paired automatically. Nothing is installed in your own
browser, and its logins are separate: the profile starts signed out of every site. Run `/browse-install-browser` to
download and verify it (about 150–210 MB). `"chromiumPath"` uses a Chromium or Chrome for Testing you already have;
branded Google Chrome is refused because it will not load a preloaded unpacked extension.

## Access

**Every tool is allowed by default.** The plugin inserts, directly after each agent's base `* * allow`, a `browse_*`
allow and one rule per known tool by exact name (`src/permissions.ts`). That means page actions, the three captures,
the session tools and `browse_secrets_run` run without a prompt.

`access` restricts it:

- `"all"` (the default): everything runs;
- `"ask-changes"`: the four reads run (`status`, `session_list`, `secrets_list`, `secrets_status`), everything else
  asks, tab cleanup included;
- `"read-only"`: the reads run, everything else is denied.

An agent's own rules, your `permissions` in `opencode.json` and a saved approval still win. `/browse-status` prints the
block in force and names agents that were created after the plugin added its rules. The scoped profile (`scope` in the
options) denies the session tools that could leave the pinned session and runs `execute` only when the session is
read-only.

A capture's `outputPath` is usually outside the project, so OpenCode also asks for `external_directory` on that folder.
Allow it once, or keep captures inside the project. A refusal costs nothing: nothing was written.

## Commands

| Command | Does |
| --- | --- |
| `/browse-status` | the binary, relay, extension, scope, tools and one next step |
| `/browse-doctor` | the vendor doctor, the binary checks and scope repair |
| `/browse-install` | download and verify the pinned browse binary |
| `/browse-install-browser` | download and verify Chrome for Testing for managed mode |
| `/browse-stop-relay` | stop the relay this plugin's binary started |
| `/browse` | the status dialog |

## Troubleshooting

| State or code | What it means | What to do |
| --- | --- | --- |
| `not configured` | no binary yet, or no release build for this computer | run `/browse-install`, then restart OpenCode; on another platform set `path` |
| `failed` | the binary does not match its digest, or a needed command failed | `/browse-doctor`, then reinstall |
| `conflict` | `mcp.servers.browse` in your config is not a browse server | remove or rename that entry, then restart |
| `disabled` | the `browse` server is disabled in `/mcps` | enable it, or remove `"disabled": true` |
| `host untested` | OpenCode is outside the supported range | use `>=2.4.1 <2.5.0`, or set `allowUntestedHost` |
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
| `RELAY_NOT_OURS` | the relay on the port was not started by this plugin's binary | leave it, or stop it with the browse install that started it |
| `RELAY_STOP_FAILED` | the relay accepted the shutdown request but did not stop | run `/browse-doctor` |
| `DOCTOR_FAILED` | the vendor doctor exited non-zero | read its checks, fix the first failure |
| `HOST_UNTESTED` | as `host untested` above | use a supported OpenCode |
| `OPTIONS_INVALID` | an option failed validation | fix the option the message names |
| `SKILLS_INVALID` | a bundled skill could not load | reinstall the plugin |
| `CHROMIUM_MISSING` | managed mode has no browser for this platform or path | run `/browse-install-browser`, or set `chromiumPath` |
| `CHROMIUM_UNSUPPORTED` | managed mode has no Chrome for Testing build for this platform | set `chromiumPath`, or use the real browser |
| `CHROMIUM_DOWNLOAD_FAILED` | the Chrome for Testing download failed | check the network, then run `/browse-install-browser` again |
| `CHROMIUM_EXTRACT_FAILED` | the Chrome for Testing download did not unzip | check `unzip`, then run `/browse-install-browser` again |
| `CHROMIUM_UNVERIFIED` | the managed browser changed since it was installed | run `/browse-install-browser` again |
| `CHROMIUM_INVALID` | `chromiumPath` is not a Chromium or Chrome for Testing binary | point it at one |
| `CHROMIUM_BRANDED` | `chromiumPath` is branded Google Chrome, which will not load the unpacked extension | point it at Chromium or Chrome for Testing |
| `CHROMIUM_INSTALL_FAILED` | `/browse-install-browser` failed before or during the install | run `/browse-doctor` and fix the first failed check |
| `EXTENSION_UNVERIFIED` | the bundled extension does not match its pin | reinstall the plugin |
| Extension not paired | the browser has no key for this relay | run the `Pair:` command `/browse-doctor` prints |
| Relay stopped | nothing has needed the browser yet | ask the agent to open a page, or run `browse status` |
| Recording needs ffmpeg | an agent-opened tab records through CDP, which needs `ffmpeg` on PATH | install `ffmpeg`, or lend a tab and record that |

## Uninstall

```sh
opencode plugin remove github:we-the-rebel-alliance/browse-plugin
```

That removes the plugin, its cached binary and its rules; it does not touch your browser. The extension is
uninstalled from your browser's extensions page. Managed mode's profile and Chrome for Testing are in
`~/.local/share/opencode-browse/managed` and `~/.cache/opencode-browse`; delete those folders to remove them.

## Links

- [Architecture](https://github.com/we-the-rebel-alliance/browse-plugin/blob/master/docs/architecture.md)
- [Configuration](https://github.com/we-the-rebel-alliance/browse-plugin/blob/master/docs/configuration.md)
- [Scripts](https://github.com/we-the-rebel-alliance/browse-plugin/blob/master/docs/scripting.md)
- [Security](https://github.com/we-the-rebel-alliance/browse-plugin/blob/master/SECURITY.md)
- [Changelog](https://github.com/we-the-rebel-alliance/browse-plugin/blob/master/CHANGELOG.md)
- [browse](https://github.com/anomalyco/browse), the upstream project
