# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [0.0.0] - Unreleased

### Added

- The `browse` MCP server, registered at runtime with the pinned browse `0.0.14` binary and adopted from a user's own
  entry when it is a browse command.
- Per-platform optional packages (`@joe-broadhead/opencode-browse-bin-<platform>`) carrying the binary, its
  `manifest/browse.json` digest and browse's MIT licence; the plugin verifies the digest before running it.
- Default permission rules by exact tool name: 8 run, 10 ask, and a tool browse adds later denied until classified.
  Switching a project into or out of the scoped profile replaces the previous block in the deciding position.
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
- A deny for a legacy `opencode-browser` server and for a conflicting `browse` entry, so neither runs unguarded.

### Fixed

- `/browse-stop-relay` stops the relay this plugin's binary started, through browse's own `/shutdown`, and refuses a
  relay on the port that is not ours (another browse build, or `managed` false). The docs name it, since a user of this
  plugin has no `browse` on PATH.
- Managed mode stops the relay it started when the plugin is disposed, through browse's own `/shutdown`, and never
  stops a relay that was already running. Real mode leaves browse's relay running, as browse does, and the docs say so.
- Tests and scripts run the pinned binary only with an isolated HOME, XDG dirs and a free port (never browse's default
  19988), and fail if a `browse serve` for that HOME outlives them.
