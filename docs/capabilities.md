# Capabilities

This page is the manifest's declaration, generated between the markers, and a note on what each capability is. Edit
`package.json` `capabilities`, not this page, then run `npm run docs`.

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

## Notes

- `status` is the contract's short answer: the plugin's state, its host range and its (empty) account list. It is what
  an app reads.
- `report` is the diagnostic report the status dialog and `/browse-status` show: the pinned binary, the relay, the
  extension, the scope, the managed browser, recording readiness, and the one next step.
- **`browse_status` is the plugin's `status`.** The browse server also lists a tool named `status`, and OpenCode
  2.4.1 gives both the effective name `browse_status`; the plugin's tool is the one registered, and the server's own
  `status` tool is not separately callable. `report` carries the relay, extension and connected-browser details the
  server's `status` answer used to provide, so nothing is lost: an agent reads `status` for the contract answer and
  `report` for the details. The server's `status` stays declared here because the server lists it and its class and
  rule are the contract's.
- No method declares `operations`: browse has no sources and no actions, so no grant compiles to one. A pass-through
  tool keeps its own `browse_<tool>` permission action, which is what OpenCode checks when the server runs it.
- The 18 `mcp:` methods belong to the `browse` MCP server. The plugin declares and classifies each one so access rules
  and consumers know how risky it is, and keeps the server registered through `ctx.mcp.transform`; it does not proxy
  them. OpenCode runs them under their own `browse_<tool>` permission action.
- `execute` is admin because it runs arbitrary Playwright as the person in their signed-in browser. `secrets_run` and
  `secrets_refresh` are admin because they use stored credentials. `session_allowlist` is share because it can widen
  where a session may load. The three deletes (`tabs_cleanup`, `session_reset`, `session_delete`) destroy local
  session state and pages, not provider data.
- There are no sources: browse has no cursor-based feed. There are no actions: browse's writes are MCP tools the server
  owns, not plugin methods with a preview and commit.
- There are no bus events: the plugin makes no write of its own to announce, and the MCP server owns its tools. An app
  reads `report` or `status` on its own cadence.
