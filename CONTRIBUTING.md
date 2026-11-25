# Contributing

Browse is one of the `we-the-rebel-alliance` plugins and follows
[the plugin standard](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/plugin-standard.md).
Read [AGENTS.md](AGENTS.md) first; it says how the repository is laid out and what the rules are.

## Before a pull request

You need Node 24. The contract is a public repository; the committed `package-lock.json` records it over HTTPS, so a
fresh `npm ci` needs no SSH key.

```sh
npm ci --ignore-scripts
npm run check          # typecheck, bundle, unit, pack, plugin-kit check, docs --check
npm run bin:ensure     # fetches and verifies the pinned binary, for the host and managed suites
npm run test:host      # the plugin in a real OpenCode 2.4.1 host (slow)
```

`npm run check` must pass with no findings. `npm run bundle` writes the committed `dist/`; CI fails when it is stale (`npm run bundle && git diff --exit-code dist/`), so commit the built files with a source change. The kit's T0 and T1 are hard gates: the namespace line, the skill
descriptions, the manifest, the generated docs, the real host, the access levels and the forbidden patterns. The host
suite needs `npm run bin:ensure` first and fails without it, rather than skipping a test.

## Changing a tool

The 18 browser tools belong to the browse server. To classify a new one, add it to `capabilities.methods` in
`package.json`, refresh `test/fixtures/live-tools.json`, then run `npm run drift` and `npm run docs`.

## A pull request

- One change per pull request, with the manifest's declaration and its code and tests.
- Conventional commits.
- The body says what changed, why, and the exact checks you ran.
