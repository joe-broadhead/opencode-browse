# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## 0.0.0 (unreleased)

### Changed

- The plugin is rebuilt under the new name `@we-the-rebel-alliance/browse-plugin`, at version `0.0.0`, with every
  repository link and install line pointing at `we-the-rebel-alliance/browse-plugin`.
- OpenCode `>=2.4.1 <2.5.0`, tested on 2.4.1 only: `@opencode/client`, `@opencode/plugin` and `@opencode/sdk` are
  exact `2.4.1` devDependencies, and the test matrix for older hosts is gone.
- The `browse` namespace line is the short fixed-context text: the user's own signed-in browser, the browse skill
  first, `tools.browse.execute({ code })`, a hand-back for logins and payments, and what browse is not for.

### Removed

- The Jelly-only surface: the per-task personal-Chrome gate, the `browser.status` / `browser.ask` / `browser.inbox` RPC,
  the `browser.connect` / `allow` / `decline` / `stop` actions, the `browser-native` view, `nativeData`, the inbox, the
  notices and their tests and docs. The action-grant verifier stays in `src/grant/action-grant.ts`.
- The Jelly-only error codes `CHROME_NOT_ALLOWED`, `CHROME_SCOPE`, `REQUEST_EXPIRED` and `NOT_YOUR_REQUEST`.

### Added

- The first release is `0.0.0`, unreleased.
