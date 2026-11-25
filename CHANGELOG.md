# Changelog

## 0.0.0 (2026-11-25)

The first release on plugin-contract v0.

- A `capabilities` manifest: plugin identity and vendor, the host range `>=2.4.1 <2.5.0` with `2.4.1` tested, the
  options schema, and a `methods` table of 20 entries — `status`, `report`, and the browse server's 18 pass-through
  tools as `mcp:<tool>`, each with its class and `accounts: "none"`.
- The pinned `browse` MCP server: its binary is resolved from the release, checked against its SHA-256 at startup and
  at every use, and served through the verifying wrapper `bin/mcp.mjs`. The binary's first-use download runs at
  `access: "all"`; `/browse-install` downloads it at any level.
- `status` through the contract's `statusAnswer` (`NO_ACCOUNTS`), and `report`, the diagnostic answer the status dialog
  and `/browse-status` read: binary, relay, extension, scope, managed browser, recording readiness and the next step.
- One `register` call for the agent tool, Code Mode and the RPC id `browse`; access rules generated from `methods` and
  the `access` option by the contract's `access` module, with `scope` narrowing them to a pinned session.
- Managed mode: a separate Chromium (pinned Chrome for Testing) with its own profile, the extension loaded unpacked and
  paired through browse's own protocol, started and stopped with the plugin.
- Five commands (`/browse-status`, `/browse-doctor`, `/browse-install`, `/browse-install-browser`,
  `/browse-stop-relay`), two skills (`browse`, `browse-capture`), a status dialog, and freshly written docs.
- Tests: unit, the plugin's own suite against the real `@opencode/sdk` 2.4.1 host, managed mode against the real
  Chrome for Testing, the packed tarball, and the contract's conformance kit (T0 and T1).
