# Contributing

## Setup

```sh
git clone https://github.com/joe-broadhead/opencode-browse.git
cd opencode-browse
npm ci
node scripts/pin.mjs        # downloads the pinned binaries into .cache/bin (about 460 MB)
node scripts/build-bins.mjs --local
npm run build
```

`npm ci` with no `.cache/bin` works; the platform package the tests need is built by `build-bins.mjs --local`. The
host and pack tests use a fake binary, so a checkout without the pin still passes everything except the pin checks in
`test/pack`.

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
| `pack` | the tarball, the bundles, the platform package resolution and the tamper refusal |
| `forbidden` | the list in `AGENTS.md` |
| `copies` | the shared tools RPC outside its plugin block |
| `whitelist` | `package.json` and `dist/` shape |

`npm run test:managed` is separate from `npm run check`, because it downloads Chrome for Testing (about 200 MB) into
an isolated cache and starts a real browser headless. It pairs automatically, opens a page this test serves, takes a
screenshot and stops; it never touches your browser, your Chrome or your profile.

Run one with `node scripts/check.mjs <stage>`. On a loaded machine, run heavy stages through
`bash ~/opencode-release/review/tools/with-slot.sh npm run check`, which allows three hosts at once.

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

## Releasing

1. Remove `"private": true` from `package.json`, set the version, and move the CHANGELOG's Unreleased section to that
   version.
2. Publish the four platform packages first (`dist-packages/*.tgz`). This is the approved bootstrap and it is by hand:
   CI cannot rebuild them from the git-ignored cache. Then tag `v<version>`; the release workflow runs the checks,
   packs, runs the pack test on that tarball, downloads each published platform package and **compares its
   `manifest/browse.json` digest with this repo's pin** (`scripts/verify-platform-packages.mjs`), and publishes with
   provenance.
3. A rerun skips a version already on npm.
