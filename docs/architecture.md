# Architecture

```
src/
  index.ts          one `Plugin.define`, `assertHost`, one `register`, and setup's disposal
  manifest.ts       the installed `capabilities` manifest, read from package.json
  package.ts        the package root, one level up from `src/` and from `dist/`
  options.ts        the options schema's runtime checks; a bad value is a status problem
  report.ts         the report's types, its formatting, and the dialog's RPC definition
  report-build.ts   the report's builder and the manifest's access counts (server half only)
  scope.ts          the `scope` option's narrowing of the contract's rules
  skills.ts         the two shipped skills: YAML frontmatter parsed, then registered through ctx.skill
  commands.ts       /browse-status, /browse-doctor, /browse-install, /browse-install-browser, /browse-stop-relay
  tui.ts            the status dialog
  handlers/
    index.ts        the handler table register takes: status and report
    status.ts       the contract's short status answer
    report.ts       the diagnostic report handler
    unguarded.ts    the one place a handler reads the agents that lack the rules
  provider/
    index.ts        setup: binary, MCP server, managed browser, pinned session, live reads
    binary.ts       the pin, resolution, verification, `browse status --json`, the pinned session
    native.ts       the native release installer (gzip + SHA-256 + size, from manifest/native.json)
    server.ts       the `browse` MCP server registration and adoption
    managed.ts      managed mode's Chromium, profile and pairing
    chromium.ts     the pinned Chrome for Testing download and verification
    extension.ts    the unpacked extension copy and its pairing file
    relay.ts        the relay's identity, ownership and shutdown
    paths.ts        the plugin's data and cache folders
    recording.ts    ffmpeg readiness for recording
```

## The layers

- **`index.ts` is the only place the contract is wired.** `assertHost` refuses an untested release; `register` adds the
  tools, the one RPC registration and the access rules from the handler table; the provider is built before it and
  disposed with it.
- **Handlers are pure where possible.** `status` and `report` read values setup already resolved and the agents their
  own call returns. They never touch tools, RPC or permissions.
- **The provider is the only place a URL, a binary or a file path is named.** It runs the pinned binary with an argument
  list, never a shell; it starts the managed Chromium; it reads the relay's `/version`.
- **Commands and skills are host surfaces, not methods.** They are registered once in setup and add no method to the
  manifest. Skills are checked before anything registers: the frontmatter is parsed as YAML, so a folded or literal
  description keeps its text, and a malformed file fails setup with `SCHEMA_VIOLATION`.

## OpenCode APIs used

Only the public `@opencode/plugin` 2.4.1 context: `ctx.app.version`, `ctx.options`, `ctx.agent`, `ctx.tool`, `ctx.rpc`,
`ctx.session`, `ctx.command`, `ctx.skill` and `ctx.mcp`. The contract's `register` uses `ctx.permission` for the
call gate. The status dialog (`src/tui.ts`) uses `@opencode/plugin/tui`: the dialog, the keymap layer and the
data events it subscribes to while open.

## What is cached

- The resolved binary, once per plugin instance; `verifyBinary` re-checks the file at each use.
- The `browse status --json` answer for three seconds, so `/browse-status` and `/browse-doctor` close together do not
  start the binary twice.
- The recording check is run once at setup and kept for the report.
- Nothing about a person, a page or a credential is cached by this plugin; the browse server owns its sessions.

## Doors

The contract's `register` wires the plugin's two methods through the agent tool, Code Mode and RPC id `browse`. The 18
browser tools are the MCP server's own: OpenCode lists them under the `browse` namespace and checks `browse_<tool>` for
each call. One of them, `status`, has the same effective name as the plugin's own `status` method; the plugin's tool is
the one registered, and `report` carries the details (docs/capabilities.md). Browse has no accounts, so there is one
server, named `browse`, and no per-alias rule. The plugin's own methods are permitted as `browse.<method>`; the server's
tools keep `browse_<tool>`.
