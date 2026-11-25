# Contributing

Browse is one of the `we-the-rebel-alliance` plugins and follows
[the plugin standard](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/plugin-standard.md).
Read [AGENTS.md](AGENTS.md) first; it says how the repository is laid out and what the rules are.

## Before a pull request

You need Node 24. The contract is a public repository; the committed `package-lock.json` records it over HTTPS, so a
fresh `npm ci` needs no SSH key.

```sh
npm ci --ignore-scripts
npm run check          # fetches the pinned binary, then typecheck, bundle, unit, pack, skills/parity host, kit checks
npm run test:host      # the plugin in a real OpenCode 2.4.1 host (slow)
```

`npm run check` must pass with no findings. `npm run bundle` writes the committed `dist/`; CI fails when it is stale (`npm run bundle && git diff --exit-code dist/`), so commit the built files with a source change. The kit's T0 and T1 are hard gates: the namespace line, the skill
descriptions, the manifest, the generated docs, the real host, the access levels and the forbidden patterns. The host
suite needs the pinned binary, which `npm run check` fetches, and fails without it rather than skipping a test.

## Changing a tool

The 18 browser tools belong to the browse server. To classify a new one, add it to `capabilities.methods` in
`package.json`, refresh `test/fixtures/live-tools.json`, then run `npm run drift` and `npm run docs`.

## Releasing and native assets

The release workflow publishes the package tarball, `conformance.json`, `SHA256SUMS`, the four
`browse-<platform>.gz` files, `LICENSE.browse` and a tag-time `native.json`. Its `native` job runs
`scripts/build-native.mjs` at the tag, then `scripts/verify-native.mjs` checks every asset against
`manifest/native.json`: the committed size and SHA-256, and the decompressed executable's size and SHA-256. It attests
the gzips and licence, and `publish` attaches all six native files by exact name; there is no owner upload. The
`check` job runs `npm run check`, which starts with `bin:ensure`, so the pinned binary is present for the pack and host
checks.

## Binary pin mirror

`manifest/browse.json` points at the organization's mirror release, `we-the-rebel-alliance/browse-binaries` release
`v<version>`. After `npm run bin:pin`, upload the four renamed `browse-<platform>-<version>.tgz` files to that mirror
release; `npm run bin:ensure` downloads from the manifest and verifies each tarball's size and SHA-256 before extracting
the binary. `BROWSE_BINARY_MIRROR` overrides the mirror base for a rehearsal.

## A pull request

- One change per pull request, with the manifest's declaration and its code and tests.
- Conventional commits.
- The body says what changed, why, and the exact checks you ran.
