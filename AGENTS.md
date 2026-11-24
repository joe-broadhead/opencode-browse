# Repository rules

This repository is the OpenCode plugin `@we-the-rebel-alliance/browse-plugin`. It ships the pinned browse binary and
wraps browse's MCP server; it never runs a browser itself.

## Layout and purpose

- `src/browse-tools.ts` is the single source of truth for the 18 tools, their annotations, classes and default effects.
  The rules, the tools RPC, status and the tests derive from it.
- `bin/mcp.mjs` is the MCP entry; it re-verifies the pinned binary at every spawn. `src/managed/` is managed mode:
  Chrome for Testing in its own profile, the pinned extension, and browse's own pairing. Never touch the user's browser,
  Chrome or profile from managed mode or its tests.
- `src/grant/action-grant.ts` verifies a host-signed, single-use action grant. It does no I/O.
- `manifest/browse.json` is the pin. `scripts/pin.mjs` writes it; `scripts/build-native.mjs` builds the release files.
- The plugin never edits a config file, never runs `browse install`, `browse update` or `browse pair`, and never adds an
  `OPENCODE_BROWSER_ALLOW_*` environment variable.

## Forbidden in this repository

- Fork-only host APIs and markers: dispatch-lease, catalog-ownership, text-only markers.
- `options.mcp` delegation, `Plugin.image` / profile images, imported OAuth grants.
- The V1 plugin API (`@opencode-ai/*`) and V1 hooks (`tool.execute.before/after`, `chat.message`, `chat.params`,
  `permission.ask`).
- `ctx.generate.text`, `experimental.policies`.
- `@opencode/ai` imports; import only `@opencode/plugin`.
- A `permission.hook("evaluate")` anywhere except the one place in `dist/index.js`, which bundles the source contract's tools RPC, where it
  turns an inner `ask` of a script's own call into a refusal.
- Private host source, host checkouts, and `consumer-host`.
- Machine-local absolute paths and `/tmp/` literals; make temp folders with `mkdtemp` under `realpathSync("/tmp")`.
- A shell: the plugin runs the binary with an argument list (`execFile`, `spawn`), never `exec`/`execSync` or `shell: true`.
- Writing under the user's config directory, or adding an `OPENCODE_BROWSER_ALLOW_*` variable.

`scripts/check-forbidden.mjs` enforces the first list and the shell rule; the typecheck enforces what the public
2.4.1 types reject.

## Checks

`npm run check` runs, in order: `typecheck`, `unit`, `kit`, `build`, `icons`, `host`, `pack`, `forbidden`, `copies`,
`jelly`, `whitelist` and `actionlint`. `npm run drift` compares the Jelly declaration with `test/fixtures/live-tools.json`
(or `--bin <path>`).

`node scripts/check.mjs <stage>` runs one stage. The host stage runs the embedded `@opencode/sdk` 2.4.1 from the
lockfile; there is one tested host.

## Commits

Conventional commits, one logical change each. No personal email in anything we publish. Publish through a pull request
on GitHub; never push to `master` directly.

Releases are cut from `.github/workflows/release.yml` when the release commit is ready, and the `native` workflow builds
the platform binaries for it. Never push a tag or a `release/*` branch, and never commit, tag or publish a release by
hand. Agents never approve a release, never call the deployment-approval API, and never bypass a ruleset or the
environment.
