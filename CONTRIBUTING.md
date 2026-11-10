# Contributing

## Setup

```sh
git clone https://github.com/joe-broadhead/opencode-browse.git
cd opencode-browse
npm ci
npm run bin:ensure   # fetches and verifies this computer's pinned binary into .cache/bin
npm run build
```

`scripts/build-native.mjs` reads the pin in `manifest/browse.json` and fetches only what it names, checking each tarball and binary
against the pin's size and SHA-256 before it uses anything. Without `npm run bin:ensure` the real-server host test prints a
skip notice (and fails in CI). Most host tests use a fake binary, so they run without it.

## Running a checkout

Register the checkout's entry in a throwaway config, or point the plugin at the binary:

```json
{
  "plugins": [{ "package": "/absolute/path/to/opencode-browse/dist/index.js", "options": { "path": "/absolute/path/to/browse" } }]
}
```

Never point it at your real browser for a test: the host suite uses `test/host/fake-browse.mjs`, which speaks the same
protocol and CLI, and never starts a relay or an extension.

**Never run the pinned binary with your real HOME.** `browse status` and anything that needs the relay create
`~/.local/share/browse/relay-token` and can leave a daemonised `browse serve` behind. To probe by hand:

```sh
npm run browse:isolated -- status --json
```

It runs with a throwaway HOME, XDG dirs and a free port, and stops the relay it started. Tests use
`test/support/relays.ts`: `assertIsolatedBrowseEnv()` before a spawn, `stopRelay()` on teardown, and
`assertNoRelayLeft()` as a failure.

## Checks

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src` and the whole test tree |
| `unit` | `bun test ./test/unit` |
| `build` | esbuild: two self-contained bundles, no relative imports |
| `icons` | the family icon contract |
| `host` | the embedded OpenCode host on 2.2.3, 2.2.4, 2.2.5 and 2.2.6, against the fake browse |
| `pack` | the tarball, the bundles, the release binary resolution and the tamper refusal |
| `forbidden` | the list in `AGENTS.md` |
| `copies` | the shared tools RPC outside its plugin block |
| `whitelist` | `package.json` and `dist/` shape |
| `jelly` | the Jelly declaration against `package.json` |
| `actionlint` | the two workflows, linted as workflows when `actionlint` is installed |

`npm run test:managed` is separate from `npm run check`, because it downloads Chrome for Testing (about 200 MB) into
an isolated cache and starts a real browser headless. It pairs automatically, opens a page this test serves, takes a
screenshot and stops; it never touches your browser, your Chrome or your profile.

Run one with `node scripts/check.mjs <stage>`. On a loaded machine, run one heavy stage at a time rather than the whole
`npm run check` in parallel with other checks.

## The pin

`manifest/browse.json` records the release, each target's tarball URL, SHA-256 and size, and the extracted binary's
SHA-256 and size. To move to a new browse release:

```sh
node scripts/pin.mjs --refresh
node scripts/check-browse-tools.mjs      # the committed fixture
node scripts/check-browse-tools.mjs --bin .cache/bin/darwin-arm64/browse
```

Classify any new tool in `src/browse-tools.ts`, re-capture `test/fixtures/live-tools.json` with
`node test/fixtures/capture-tools.mjs`, and update the Jelly section and the docs in the same commit. The capture runs
the binary with a fresh `HOME`, `XDG_*` and `TMPDIR`, no installer and no pairing, and kills only its own child.

## Managed mode's pins

`scripts/pin-managed.mjs` pins two artefacts: browse's built extension (from the release service's stable zip, verified
by SHA-256 and unpacked into `managed-extension/`, with every file's digest in `manifest/extension.json`) and a Chrome
for Testing version (its four downloads measured here, in `manifest/chromium.json`, because CfT publishes no hashes).
Move either with `node scripts/pin-managed.mjs --refresh`, and commit `managed-extension/` with the manifest.

`managed-extension/` is the vendor's built output, unpacked from the pinned zip and checked file by file against
`manifest/extension.json`. Nobody edits it by hand, so the 600-line rule does not apply to its bundles.

## Release

### Releasing

Every plugin releases as `v0.0.0`, and it installs from that GitHub tag. The release is one commit on top of a `master`
head that CI passed, and the tag points at it.

1. Set `version` to `0.0.0` in `package.json`, date the `## [0.0.0]` entry in `CHANGELOG.md`, then run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. In a clean checkout of `master` at that commit, run `node scripts/release-commit.mjs --ci-sha <its full sha>`. It builds
   `dist/`, removes the lifecycle scripts, and creates the signed commit and the signed annotated tag `v0.0.0`. It never
   pushes; `--dry-run` shows the change first.
4. Push the tag only: `git push origin v0.0.0`.
5. Approve the run in the `release` environment. The release workflow checks the tag and its commit, installs the tag on
   each stock OpenCode host (2.2.3 to 2.2.6), packs it, and creates the GitHub Release with the notes, the tarball and
   `SHA256SUMS`.

A tag that already exists stops step 3. Delete the old tag and its Release first, then start again.


Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-browse#v0.0.0`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-browse#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-browse#v0.0.0" }] }
```
