# Configuration

The plugin's options live under its entry in `opencode.json`. Every option is optional; the defaults are the narrowest
that work.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much browse's tools may do without asking: everything, ask before changes, or reads only. |
| `allowUntestedHost` | boolean | `false` | Start on an OpenCode release outside the supported range. |
| `path` | string | — | A browse binary to run instead of the pinned release. It is reported unverified and untested. |
| `browser` | `real` \| `managed` | `"real"` | "real" drives the browser the person is signed in to; "managed" runs a separate Chromium with its own profile. |
| `chromiumPath` | string | — | A Chromium or Chrome for Testing binary for managed mode, instead of the pinned download. |
| `headless` | boolean | `false` | Run the managed browser headless. Headed by default, so the person can watch. |
| `verifyBinary` | boolean | `true` | Check the pinned binary's SHA-256 before running it. |
| `scope` | object | — | Pin the browse server to one session, so it cannot reach another. |
<!-- /generated:configuration -->

## Examples

A signed-in browser, everything allowed:

```json
{ "plugins": [{ "package": "github:we-the-rebel-alliance/browse-plugin#v0.0.0" }] }
```

Ask before every change:

```json
{ "plugins": [{ "package": "github:we-the-rebel-alliance/browse-plugin#v0.0.0", "options": { "access": "ask-changes" } }] }
```

Pin the server to one session, read-only, on two sites:

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/browse-plugin#v0.0.0",
      "options": { "scope": { "session": "research", "readOnly": true, "allowedOrigins": ["github.com", "*.wikipedia.org"] } }
    }
  ]
}
```

Managed mode, headed, with a Chromium you built yourself:

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/browse-plugin#v0.0.0",
      "options": { "browser": "managed", "chromiumPath": "/Applications/Chromium.app/Contents/MacOS/Chromium" }
    }
  ]
}
```

## What the options do

- **`access`** generates the default rules for every agent: `all` runs everything, `ask-changes` asks before a method
  that is not a read, and `read-only` turns those methods off. See the README's table.
- **`path`** runs a browse binary you name instead of the pinned release. It is reported unverified and untested; only
  the pinned release is checked against a digest.
- **`browser`** chooses the person's browser (through the extension) or a separate Chromium the plugin starts and stops.
- **`chromiumPath`** uses your own Chromium build for managed mode; the pinned Chrome for Testing is used otherwise.
- **`headless`** hides the managed browser's window. Headed is the default so the person can watch.
- **`verifyBinary`** checks the pinned binary's SHA-256 at startup and at every use. Leave it on.
- **`scope`** pins the server to one browse session. With `scope` set, `session_new`, `session_use`, `session_adopt`,
  `session_delete` and `session_allowlist` are denied, and `execute` asks unless the session is read-only (the relay
  then refuses all input) — so the plugin cannot leave the session you pinned. `allowedOrigins` narrows the session's
  tabs further; empty means browse's own default.
- **`allowUntestedHost`** starts on an OpenCode release outside `>=2.4.1 <2.5.0`. Status says the host is untested.
  Leave it off.

An unknown option, a wrong type or an unreadable value is refused with `OPTIONS_INVALID`, and status says which option
it was; the plugin stays loaded so you can read the report and fix it. The one exception is `access`: an invalid level
is refused at startup by the contract's access module, because a plugin may not fall back to a wider level.
