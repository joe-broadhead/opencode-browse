# Contributing

Browse is one of the `we-the-rebel-alliance` plugins and follows
[the plugin standard](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/plugin-standard.md).
Read [AGENTS.md](AGENTS.md) first; it says how the repository is laid out and what the rules are.

## Before a pull request

```sh
npm ci
npm run check          # typecheck, build, unit, pack, plugin-kit check
npm run docs -- --check
npm run test:host      # the plugin in a real OpenCode 2.4.1 host (slow)
```

`npm run check` must pass with no findings. The kit's T0 and T1 are hard gates: the namespace line, the skill
descriptions, the manifest, the generated docs, the real host, the access levels and the forbidden patterns.

## Changing a tool

The 18 browser tools belong to the browse server. To classify a new one, add it to `capabilities.methods` in
`package.json`, refresh `test/fixtures/live-tools.json`, then run `npm run drift` and `npm run docs`.

## A pull request

- One change per pull request, with the manifest's declaration and its code and tests.
- Conventional commits.
- The body says what changed, why, and the exact checks you ran.
