# Repository rules

This repository is the OpenCode plugin `@joe-broadhead/opencode-browse`. It ships the pinned browse binary and wraps
browse's MCP server; it never runs a browser itself.

## Layout and purpose

- `src/browse-tools.ts` is the single source of truth for the 18 tools, their annotations, classes and default effects.
  The rules, the tools RPC, status, the Jelly section and the tests derive from it.
- `bin/mcp.mjs` is the MCP entry; it re-verifies the pinned binary at every spawn. `src/managed/` is managed mode:
  Chrome for Testing in its own profile, the pinned extension, and browse's own pairing. Never touch the user's browser,
  Chrome or profile from managed mode or its tests.
- `manifest/browse.json` is the pin. `scripts/pin.mjs` writes it; `scripts/build-bins.mjs` builds the platform packages.
- The plugin never edits a config file, never runs `browse install`, `browse update` or `browse pair`, and never adds an
  `OPENCODE_BROWSER_ALLOW_*` environment variable.

## Forbidden in this repository

- Fork-only host APIs and markers: dispatch-lease, catalog-ownership, text-only markers.
- `options.mcp` delegation, `Plugin.image` / profile images, imported OAuth grants.
- The V1 plugin API (`@opencode-ai/*`) and V1 hooks (`tool.execute.before/after`, `chat.message`, `chat.params`,
  `permission.ask`).
- `ctx.generate.text`, `experimental.policies`.
- `@opencode/ai` imports; import only `@opencode/plugin`.
- A `permission.hook("evaluate")` anywhere except the one place in `src/host/tools-rpc.ts` (and its bundle), where it
  turns an inner `ask` of a script's own call into a refusal.
- Private host source, host checkouts, and `consumer-host`.
- Machine-local absolute paths and `/tmp/` literals; make temp folders with `mkdtemp` under `realpathSync("/tmp")`.
- A shell: the plugin runs the binary with an argument list (`execFile`, `spawn`), never `exec`/`execSync` or `shell: true`.
- Writing under the user's config directory, or adding an `OPENCODE_BROWSER_ALLOW_*` variable.

`scripts/check-forbidden.mjs` enforces the first list and the shell rule; the typecheck enforces what the public
2.2.3 types reject.

## Checks

`npm run check` runs, in order: `typecheck`, `unit`, `build`, `icons`, `host` (every SDK in `TESTED_HOSTS`), `pack`,
`forbidden`, `copies`, `jelly`, `whitelist` and `actionlint`. `npm run drift` compares the table with `test/fixtures/live-tools.json` (or `--bin <path>`).

`node scripts/check.mjs <stage>` runs one stage. The host stage runs on 2.2.3 from the lockfile and installs 2.2.4 and
2.2.5 into a temp folder; `HOST_SDK_DIR` runs one SDK only.

## Commits

Conventional commits, one logical change each, signed, authored as
`Joe Broadhead <91376460+joe-broadhead@users.noreply.github.com>`. Never push this repository: it has no remote until
hand-over.
