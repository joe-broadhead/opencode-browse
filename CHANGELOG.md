# CHANGELOG

## [0.0.0]

The first release on plugin-contract v0.

### Added

- A `capabilities` manifest: plugin identity and vendor, the host range `>=2.4.1 <2.5.0`, the options schema, and a
  `methods` table that classifies all 18 browser tools plus the plugin's own `status` and `report`.
- `status`, the contract's short answer (host range, state, empty account list, next step), and `report`, the
  diagnostic answer the status dialog and `/browse-status` show.
- A generated `docs/` set and two skills, written for v0.

### Changed

- The plugin is one `contract.register` call: the tools, the RPC id `browse` and the access rules come from the
  contract. The RPC id was `browse.tools`.
- Access rules come from the contract's `access` module; the `scope` option only narrows them.
- The plugin's entry is `./server` (`dist/index.js`), with `./tui` for the dialog.

### Removed

- The copied tools-RPC transport and its `browse.tools` RPC id.
- The copied action-grant verifier: the contract's `grant` module replaces it, and browse has no action that needs one.
- The copied release, drift, copies, icons, forbidden, tested-hosts, capture-tools and changelog scripts; `plugin-kit`
  provides them.
- The legacy app key, the `sources` key and the `opencode` key in `package.json`.
