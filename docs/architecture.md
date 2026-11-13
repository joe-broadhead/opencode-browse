# Architecture

The plugin is a thin layer over the pinned browse binary. OpenCode owns the MCP transport, the tool list, permission
prompts and Code Mode; browse owns the relay, the extension and the browser. This plugin registers the server at
runtime, ships the binary, classifies its 18 tools, sets default permission rules, reports status, ships two skills and
lets scripts call the known tools. It adds no tool of its own, makes no browser call of its own, and never edits a
config file. Under jelly it gates the person's Chrome per task ([jelly.md](jelly.md)).

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | the server entry: `Plugin.define({ id: "browse", setup })` |
| `src/plugin.ts` | setup, server registration or adoption, the scoped session, cleanup |
| `src/constants.ts` | ids, server name, pinned version, namespace text, host range, error shape |
| `src/browse-tools.ts` | one table: all 18 tools, their MCP annotations, class and default effect. No runtime imports, so the drift script loads it |
| `src/permissions.ts` | the rule block, insertion after the base allow, guarded detection |
| `src/engine.ts` | the binary: resolution, digest verification, `--version`, `status --json`, the scoped session |
| `bin/mcp.mjs` | the MCP entry: re-verifies the pinned binary at every spawn, then serves it with supervision and auto-update off |
| `src/managed/` | managed mode: Chrome for Testing (`chromium.ts`), the pinned extension (`extension.ts`), and the browser's lifecycle and pairing (`browser.ts`) |
| `manifest/chromium.json`, `manifest/extension.json` | the CfT pin and the extension's per-file digests |
| `src/options.ts` | options, `OPTIONS_INVALID` |
| `src/status.ts` | the one status model, `/browse-status`, the status RPC |
| `src/doctor.ts` | `/browse-doctor`: the vendor doctor, the binary checks, scope repair |
| `src/skills.ts` | loading and registering `skills/` |
| `src/tui.ts` | `/browse` and the palette command "Browse: Status" |
| `src/jelly/` | jelly's side: the per-task gate on the person's Chrome (`chrome-gate.ts`), the gate on every server tool, the `personal-browser` read, its actions, the Inbox read and the ask's notice (`native.ts`), and the action-grant check (`action-grant.ts`); see [jelly.md](jelly.md) |
| `views/browser.html` | the `browser-native` page jelly shows: the state, the ask, Allow for this task and Stop |
| `src/host/tools-rpc.ts` | the shared tools RPC v2.1, with this plugin's block between the markers |
| `manifest/browse.json` | the pin: version, channel, and each target's tarball URL, SHA-256, size, binary SHA-256 and size |
| `scripts/pin.mjs` | downloads and verifies the pinned targets into `.cache/bin` |
| `scripts/build-native.mjs` | `--ensure` fetches and verifies this computer's pinned binary into `.cache/bin`; `--release` writes the release files and the candidate manifest |
| `scripts/check-browse-tools.mjs` | the drift check against the fixture or a binary |

## Setup

1. `parseOptions` validates the options; a bad one is kept for status, never thrown.
2. `checkHost` compares `ctx.app.version` with `>=2.2.3 <2.3.0`; outside it nothing is set up unless
   `allowUntestedHost` is true.
3. The skills are read from `../skills/`.
4. `resolveBinary` finds the released binary in the cache (a first-use download runs only at access `all`), verifies its SHA-256 against the pin, and returns it. No
   PATH lookup: a project dependency named `browse` never gets the browser, and the `OPENCODE_BROWSE_BIN` seam is
   ignored unless `OPENCODE_BROWSE_TEST=1`. A missing or tampered binary registers nothing and becomes a status
   problem.
5. `ctx.mcp.transform` sets `mcp.servers.browse = { type: "local", command: [<package>/bin/mcp.mjs, "mcp"], environment: { OPENCODE_BROWSER_MCP_DIRECT: "1", OPENCODE_BROWSER_AUTO_UPDATE: "off", session? } }`, or
   adopts the user's own browse entry from the vendor's installer by replacing only its command. Any other entry under
   the name is a conflict. A legacy `opencode-browser` entry is reported.
6. `ctx.tool.transform` names the Code Mode namespace, unless the name is in conflict.
7. `ctx.agent.transform` inserts the default rules after each agent's base `* * allow`; the scoped profile applies
   when `scope` is set.
8. With `scope`, `ensureScope` lists, creates or repairs the pinned session with the vendor CLI.
9. Under jelly, in real mode, `ctx.tool.transform` puts the per-task gate in front of every executor of the browse server and the
   plugin watches for deleted and archived sessions; the `personal-browser` RPC is registered under the package name.
10. `ctx.skill.transform`, `/browse-status`, `/browse-doctor`, `/browse-install-browser`, the status RPC and the tools
   RPC are registered.
11. With `"browser": "managed"`, a `ManagedBrowser` prepares the extension copy, mints a code through `browse pair`,
    writes it for the unpacked extension, launches Chrome for Testing and waits for the relay to report the extension
    connected. It is stopped on dispose. With invalid options or an untested host the plugin still loads: status only,
    with the deny nets in place.

## The relay's lifetime

The relay is a **daemon**: `browse pair`, an MCP tool call or `browse execute` starts `browse serve`, which detaches
(its parent becomes pid 1) and keeps the browser paired after the process that started it exits. It listens on
`127.0.0.1:19988` unless `OPENCODE_BROWSER_PORT` says otherwise.

- **Real mode leaves it running.** That is browse's design: the extension stays paired, and the next OpenCode session
  reuses the relay. **`/browse-stop-relay`** stops it: it reads `/version`, refuses a relay that is not this plugin's
  own (`managed` false, another browse version, or a pid whose command line is not the pinned binary), and then calls
  browse's own `/shutdown` with the relay token. Never a kill by name, and no token in the output.
- **Managed mode stops the relay it started**, together with the managed browser, on dispose. It never stops a relay
  that was already running, and only a relay that reports `managed: true` is shut down, through browse's own
  `/shutdown` with the relay token. The next start pairs again with a fresh one-time code.

## Managed mode's pairing

browse's unpacked build reads `relay-pairing.json` from its own folder (`chrome.runtime.getURL`) and exchanges that
one-time code for a per-browser key. The plugin uses exactly that: `browse pair --wait-seconds 120` starts the relay
and mints a code, the plugin writes `{ code }` to the managed extension copy (mode 0600) and launches Chrome for
Testing with `--load-extension` and `--disable-extensions-except`; the extension redeems the code, and the pair
command's own confirmation ends the attempt. The file is removed afterwards. Nothing is minted, guessed or bypassed by
the plugin, and the code never reaches status, a log or a transcript.

The store zip carries no manifest `key`, so Chrome would derive an extension id from the folder path and the relay
would reject its WebSocket origin. The pinned copy adds browse's public manifest key, which derives the id
`afeafocngkodbmaipcngoamamfmekgfo` — the one browse's relay accepts — and `verifyExtension` refuses a copy whose key does
not.

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
