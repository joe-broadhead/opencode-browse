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

## Checks

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src` and the whole test tree |
| `unit` | `bun test ./test/unit` |
| `build` | esbuild: two self-contained bundles, no relative imports |
| `icons` | the family icon contract |
| `host` | the embedded OpenCode host on 2.2.3, 2.2.4 and 2.2.5, against the fake browse |
| `pack` | the tarball, the bundles, the platform package resolution and the tamper refusal |
| `forbidden` | the list in `AGENTS.md` |
| `copies` | the shared tools RPC outside its plugin block |
| `whitelist` | `package.json` and `dist/` shape |

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

## Releasing

1. Remove `"private": true` from `package.json`, set the version, and move the CHANGELOG's Unreleased section to that
   version.
2. Publish the four platform packages first (`dist-packages/*.tgz`), then tag `v<version>`; the release workflow runs
   the checks, packs, runs the pack test on that tarball, and publishes with provenance.
3. A rerun skips a version already on npm.
