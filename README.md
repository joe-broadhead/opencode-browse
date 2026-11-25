# Browse plugin

Drive the person's real Chromium browser from OpenCode: their tabs, logins and extensions, with a hand-back for
logins, 2FA and payments. The plugin registers the pinned `browse` MCP server, verifies its binary, and optionally runs
a separate Chromium with its own profile (managed mode).

An unofficial plugin. It is not affiliated with OpenCode or with the browse product's vendor.

## Requirements

- OpenCode `>=2.4.1 <2.5.0` (tested on `2.4.1`).
- macOS (arm64 or x64) or Linux (x64 or arm64) for the pinned binary.
- The browse extension, paired once, for real mode. Managed mode pairs its own copy.

## Install

This repository's first release on plugin-contract is `v0.0.0`. Once it is tagged:

```sh
opencode plugin add github:we-the-rebel-alliance/browse-plugin#v0.0.0
```

The binary is downloaded and verified on first use at `access: "all"` (the default), or with `/browse-install` at any
access level (about 115-135 MB). Managed mode's pinned Chrome for Testing is downloaded with `/browse-install-browser`
(about 195-210 MB).

## What it does

- **Real mode** (default) drives the browser the person already uses, through the browse extension: their tabs, their
  logins, their extensions. They can watch or take over at any time.
- **Managed mode** (`"browser": "managed"`) runs a separate Chromium with its own profile, started by the plugin and
  stopped when it unloads. It starts signed out of every site.
- **A pinned session** (`"scope"`) pins the server to one session, so its tools cannot reach another; the tools that
  could leave it are off, and `execute` asks unless the pinned session is read-only.
- **The pinned binary** is the only executable this plugin runs. It is checked against its release's SHA-256 at startup
  and at every use; a person's own `path` is reported unverified and untested.

The browse server's 18 tools do the work: `execute` runs Playwright code on a session's page, the `session_*` tools
manage named sessions, `settings` reads or changes browse's own settings, and `network`, `recording`, `flight_recorder`,
`secrets_list`, `secrets_status`, `secrets_run` and `secrets_refresh` capture traffic, record video and use stored
credentials. The plugin adds two reads of its own: `status` (the contract's short answer) and `report` (the diagnostic
report the status dialog shows). `browse_status` is the plugin's `status`: the server's own `status` tool has the same
effective name on OpenCode 2.4.1, so `report` carries the relay, extension and browser details.

## Access

`access` is `all` (the default), `ask-changes` or `read-only`:

| Level | Reads | Everything else |
|---|---|---|
| `all` | runs | runs |
| `ask-changes` | runs | asks first |
| `read-only` | runs | off |

The plugin's methods follow the same table: `status` and `report` are reads. The 18 browser tools are classified in the
manifest — `execute`, `secrets_run` and `secrets_refresh` are admin, the captures are export, the session and settings
changes are write, the deletions are delete, `session_allowlist` is share — so `ask-changes` asks before each of them
and `read-only` turns them off. An agent's own rules and the person's rules still win. A tool the server adds later is
not in this manifest until the plugin's next release; it follows the agent's own rules.

The generated rules are inserted after each agent's base allow. An agent that lacks them is named in `status`; the
plugin never patches it behind the person's back.

## Capabilities

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `report` | read | none | — |
| `mcp:status` | read | none | — |
| `mcp:session_list` | read | none | — |
| `mcp:secrets_list` | read | none | — |
| `mcp:secrets_status` | read | none | — |
| `mcp:tabs_cleanup` | delete | none | — |
| `mcp:execute` | admin | none | — |
| `mcp:session_new` | write | none | — |
| `mcp:session_use` | write | none | — |
| `mcp:session_adopt` | write | none | — |
| `mcp:session_reset` | delete | none | — |
| `mcp:session_delete` | delete | none | — |
| `mcp:settings` | write | none | — |
| `mcp:network` | export | none | — |
| `mcp:recording` | export | none | — |
| `mcp:flight_recorder` | export | none | — |
| `mcp:secrets_run` | admin | none | — |
| `mcp:secrets_refresh` | admin | none | — |
| `mcp:session_allowlist` | share | none | — |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Errors

<!-- generated:errors -->
| Code | Meaning |
|---|---|
| `NEEDS_SIGN_IN` | the account is not signed in |
| `SCOPE_MISSING` | the call needs a scope the person has not confirmed |
| `ACCOUNT_REQUIRED` | the plugin serves several accounts and the call names none |
| `ACCOUNT_UNKNOWN` | the call names an alias the plugin does not serve |
| `ACCOUNT_MISMATCH` | the item belongs to another account |
| `CURSOR_INVALID` | the cursor is malformed, or belongs to another source, account or scope |
| `CURSOR_EXPIRED` | the provider no longer keeps the history the cursor names |
| `RATE_LIMITED` | the provider asked the plugin to slow down |
| `BUDGET_EXCEEDED` | the read would cost more than the person allows |
| `SOURCE_DISABLED` | the person turned this source or action off |
| `TOO_LARGE` | the answer is larger than the source's maxBytes |
| `INPUT_INVALID` | the input does not match the method's schema |
| `SOURCE_UNKNOWN` | the plugin declares no such source |
| `SCHEMA_VIOLATION` | an answer does not keep the contract's shape |
| `PERMISSION_DENIED` | the person's grant does not cover the call |
| `PLAN_INVALID` | the plan is missing, or belongs to another method |
| `PLAN_USED` | the plan was already used by an earlier commit |
| `GRANT_INVALID` | the action grant did not verify, or was already spent |
| `HOST_UNTESTED` | OpenCode is outside the plugin's tested range |
| `OPTIONS_INVALID` | the plugin's options do not match their schema |
| `UNAVAILABLE` | the provider could not be reached |
<!-- /generated:errors -->

Browse's own codes:

| Code | Meaning |
|---|---|
| `SERVER_NOT_REGISTERED` | the `browse` MCP server could not be registered; restart OpenCode |
| `SERVER_LEGACY` | an older `opencode-browser` server is still configured; remove that entry and restart |
| `BINARY_MISSING` | the pinned binary is not installed; run `/browse-install` |
| `BINARY_UNVERIFIED` | the binary does not match its pinned SHA-256 or its file mode; reinstall it |
| `UNSUPPORTED_PLATFORM` | this platform has no pinned binary; set `path` to your own |
| `SCOPE_LOST` | the pinned session is missing or no longer has the configured scope; run `/browse-doctor` |
| `SCOPE_UNREACHABLE` | the pinned session could not be created or repaired; pair the browser, then run `/browse-doctor` |
| `RELAY_FAILED` | the browse relay reported an error; run `/browse-doctor` |
| `RELAY_NOT_OURS` | the relay on the port belongs to another installation, so it is left alone |
| `RELAY_STOP_FAILED` | the relay could not be stopped; see `/browse-doctor` |
| `STATUS_UNAVAILABLE` | the status report could not be read; restart OpenCode |
| `DOCTOR_FAILED` | the vendor doctor exited non-zero; fix its first failing check |
| `NOT_INSTALLED` | there is no pinned binary to identify the relay; reinstall the plugin |
| `SKILLS_INVALID` | a shipped skill file is missing or malformed; reinstall the plugin |
| `CHROMIUM_MISSING` | managed mode's Chrome for Testing is not installed; run `/browse-install-browser` |
| `CHROMIUM_INVALID` | the Chrome for Testing download is not the pinned file; reinstall it |
| `CHROMIUM_BRANDED` | the named Chromium is a branded build managed mode does not run; set `chromiumPath` to a Chromium build |
| `CHROMIUM_UNSUPPORTED` | this platform has no pinned Chrome for Testing; set `chromiumPath` |
| `CHROMIUM_DOWNLOAD_FAILED` | the Chrome for Testing download failed; try again |
| `CHROMIUM_EXTRACT_FAILED` | the Chrome for Testing archive could not be extracted; try again |
| `CHROMIUM_UNVERIFIED` | the Chrome for Testing download does not match its pin; reinstall it |
| `CHROMIUM_INSTALL_FAILED` | managed mode's browser could not be installed; run `/browse-doctor` |
| `EXTENSION_UNVERIFIED` | the managed extension copy does not match its pin; reinstall the plugin |

## Docs

- [Capabilities](docs/capabilities.md)
- [Configuration](docs/configuration.md)
- [Accounts](docs/accounts.md): browse signs in to nothing
- [Automations](docs/automations.md): browse has no events source
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [CHANGELOG](CHANGELOG.md)
