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
- An opt-in scoped profile that pins the server to one browse session, read-only and/or limited to allowed origins,
  and denies the session tools that could leave it.
- `/browse-status`, the `/browse` dialog, the `browse/status` RPC and `/browse-doctor`, with the family's shared status
  fields and one next step.
- The `browse.tools` RPC (v2.1), one method per known tool with its class.
- The `browse` and `browse-capture` skills, and the Jelly declaration.
- `npm run drift`, which compares the table with the pinned release's `tools/list` or with a binary you point it at.
