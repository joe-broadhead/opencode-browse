# Architecture

The plugin is a thin layer over the pinned browse binary. OpenCode owns the MCP transport, the tool list, permission
prompts and Code Mode; browse owns the relay, the extension and the browser. This plugin registers the server at
runtime, ships the binary, classifies its 18 tools, sets default permission rules, reports status, ships two skills and
lets scripts call the known tools. It adds no tool of its own, makes no browser call of its own, and never edits a
config file.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | the server entry: `Plugin.define({ id: "browse", setup })` |
| `src/plugin.ts` | setup, server registration or adoption, the scoped session, cleanup |
| `src/constants.ts` | ids, server name, pinned version, namespace text, host range, error shape |
| `src/browse-tools.ts` | one table: all 18 tools, their MCP annotations, class and default effect. No runtime imports, so the drift script loads it |
| `src/permissions.ts` | the rule block, insertion after the base allow, guarded detection |
| `src/engine.ts` | the binary: resolution, digest verification, `--version`, `status --json`, the scoped session |
| `src/options.ts` | options, `OPTIONS_INVALID` |
| `src/status.ts` | the one status model, `/browse-status`, the status RPC |
| `src/doctor.ts` | `/browse-doctor`: the vendor doctor, the binary checks, scope repair |
| `src/skills.ts` | loading and registering `skills/` |
| `src/tui.ts` | `/browse` and the palette command "Browse: Status" |
| `src/host/tools-rpc.ts` | the shared tools RPC v2.1, with this plugin's block between the markers |
| `manifest/browse.json` | the pin: version, channel, and each target's tarball URL, SHA-256, size, binary SHA-256 and size |
| `scripts/pin.mjs` | downloads and verifies the pinned targets into `.cache/bin` |
| `scripts/build-bins.mjs` | builds `dist-packages/opencode-browse-bin-<platform>` from the pin |
| `scripts/check-browse-tools.mjs` | the drift check against the fixture or a binary |

## Setup

1. `parseOptions` validates the options; a bad one is kept for status, never thrown.
2. `checkHost` compares `ctx.app.version` with `>=2.2.3 <2.3.0`; outside it nothing is set up unless
   `allowUntestedHost` is true.
3. The skills are read from `../skills/`.
4. `resolveBinary` finds the platform package, verifies the binary's SHA-256 against its manifest, and returns it. No
   PATH lookup: a project dependency named `browse` never gets the browser. A missing or tampered binary registers
   nothing and becomes a status problem.
5. `ctx.mcp.transform` sets `mcp.servers.browse = { type: "local", command: [<binary>, "mcp"], environment }`, or
   adopts the user's own browse entry from the vendor's installer by replacing only its command. Any other entry under
   the name is a conflict. A legacy `opencode-browser` entry is reported.
6. `ctx.tool.transform` names the Code Mode namespace, unless the name is in conflict.
7. `ctx.agent.transform` inserts the default rules after each agent's base `* * allow`; the scoped profile applies
   when `scope` is set.
8. With `scope`, `ensureScope` lists, creates or repairs the pinned session with the vendor CLI.
9. `ctx.skill.transform`, `/browse-status`, `/browse-doctor`, the status RPC and the tools RPC are registered.

Transforms are synchronous and never throw: a failure is kept for status and cleared when the next replay succeeds.

## Platform facts

| Fact | Value |
| --- | --- |
| Host plugin API | `@opencode/plugin` 2.2.3 (the SDK the lockfile pins) |
| Local MCP server | `Mcp.LocalConfig { type: "local", command, cwd?, environment?, disabled?, codemode?, timeout?, protocol? }` |
| Tool name | `<server>_<tool>`, so `browse_execute`; Code Mode groups them as `tools.browse.execute(...)` |
| Permission evaluation | the last matching rule wins, resource `*` for MCP calls; no match asks |
| Denied MCP tool | hidden from `ctx.tool.list()`, so Code Mode's catalog does not show it |
| Server instructions | the `initialize` instructions reach the system prompt; browse sends a short usage guide |
| Bundle reload | an in-place plugin reload reuses unchanged module records, so each entry is one self-contained file |
| Status RPC | `browse/status`, one method; the TUI part cannot see the server's findings, so it asks |

The pinned binary reports `browse <version>` for `--version`, and `browse status --json` prints a pretty JSON envelope
whose `sessions` carry `readOnly` and `allowedOrigins`. Exit code 4 means the relay is stopped, which is a state, not
a failure.

## The tools RPC

`browse.tools` is the shared v2.1 module, `57377eb3…`, with this plugin's block: all 18 tools as MCP methods, each with
its class, so a script gets the reads and is refused the rest unless a config rule allows them. `docs/scripting.md`
lists the methods.
