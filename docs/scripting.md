# Scripts

The plugin exposes `browse.tools`, one method per known browse tool, so a script can call them with no model. The
session is created for the script with an agent (`opencode api post /api/session`, with `data.id` kept), and the body is
`{"input":{"sessionID":"<id>","input":{…}}}`: both keys are required, and no other key is allowed.

```sh
opencode api post /api/rpc/browse.tools/session_list -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"<id>","input":{}}}'
```

`describe` lists every method with its class and, given a session, the permission the call would get:

```sh
opencode api post /api/rpc/browse.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"<id>"}}'
```

A `browse` result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts
joined by newlines.

## Methods

| Method | Class | Default |
| --- | --- | --- |
| `status` | read | allow |
| `session_list` | read | allow |
| `secrets_list` | read | allow |
| `secrets_status` | read | allow |
| `tabs_cleanup` | destructive | allow |
| `session_new` | write | allow |
| `session_use` | write | allow |
| `session_adopt` | write | allow |
| `session_reset` | destructive | allow |
| `session_delete` | destructive | allow |
| `settings` | write | allow |
| `execute` | destructive | allow |
| `secrets_run` | destructive | allow |
| `secrets_refresh` | destructive | allow |
| `session_allowlist` | destructive | allow |
| `network` | export | allow |
| `recording` | export | allow |
| `flight_recorder` | export | allow |

**Every tool is allowed by default**, and so is a tool browse adds later (`browse_*`). A script gets the same default:
the tools RPC resolves the rule before dispatch, and the default allow *is* that allow, so a script can call every
method without a prompt.

**The three captures run by default, and a script can start one with no model turn and no prompt.** That is a
deliberate default, and it is worth weighing before you grant a script a session:

- `network` captures authenticated request and response **headers and bodies** from the user's logged-in session
  (credential-bearing fields become references, the rest is in clear) and writes a redacted HAR to a path the script
  chooses.
- `recording` records the real tab's **pixels**, and its **audio** in tab-capture mode, to a path the script chooses.
- `flight_recorder` keeps a rolling buffer of the tab's pixels and `save_last` writes a clip to a path the script
  chooses.

The artifacts stay where the script writes them, for as long as the file exists. A path outside the project also needs
an `external_directory` allow, because OpenCode asks for that as well as for the capture's own action before anything
is written: `{ "action": "external_directory", "resource": "<the captures folder>/*", "effect": "allow" }`. A refusal
that names `external_directory` costs nothing, because nothing was written.

To restrict a script, do one of three:

1. set the plugin's `access` option to `"ask-changes"` (every changing method asks, and a script's ask is refused
   because no one can answer it) or `"read-only"` (every changing method is denied);
2. give the script's agent its own `deny` rule for a method, such as
   `{ "action": "browse_recording", "resource": "*", "effect": "deny" }`;
3. turn on scoped mode, which denies the session tools that could leave the pinned session.

Only `allow` runs. An `ask` is refused with `PERMISSION_DENIED` and no prompt, because a script cannot answer one; a
`deny` is refused and the method is absent from the agent's tool list. A saved "Always allow" does not authorize a
script: a script's grant is a rule in config, or a Jobs run session.

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/<id>/<method> -H "x-opencode-directory:$PWD" -d '{…}'
```

Without it the call goes to the service's default location and fails `rpc.unavailable` if the plugin is not loaded
there. The HTTP equivalents are the `location[directory]` query parameter and the same header. `describe` reports the
`location` that answered and a `locationHint`.

A location unloads after OpenCode's idle timeout. If a scheduled script gets `rpc.unavailable` from a location that was
loaded before, send the call again once: the request loads the location. Jobs keeps its own location loaded.

## Refusals

A refusal is the RPC error `failed` with `data: { code, next }`:

| Code | When | What to do |
| --- | --- | --- |
| `PERMISSION_DENIED` | the rule resolves to ask, or a deny hides the method | add an allow rule for the method to the session's agent or to the session |
| `SESSION_UNKNOWN` | the session does not exist in this location | create the session in the location you mean, and pass its id |
| `SESSION_AGENT_REQUIRED` | the session names no agent | create a session that names an agent |
| `TOOL_UNAVAILABLE` | OpenCode does not list the method's tool now | call `describe` to see the methods there are |
| `UPSTREAM_ERROR` | browse returned an error | read the first line, and run `/browse-doctor` |
| `CANCELLED` | the call was cancelled | call the method again if you still need the result |
| `BINARY_MISSING`, `BINARY_UNVERIFIED` | the pinned binary is absent or does not match its digest | reinstall the plugin so its platform package is restored |
| `SERVER_CONFLICT`, `SERVER_LEGACY` | another server holds the `browse` name, or an older one is configured | remove it, then run `opencode reload` |
| `SCOPE_UNREACHABLE`, `SCOPE_LOST` | the pinned session cannot be reached, or was lost | run `/browse-doctor` and follow its next step |

Every other code the plugin raises is in `docs/configuration.md`, with its one next step.

Known limit (`DC-2`, shared across the family): a saved "Always allow" answer from an earlier session is not part of the
agent and session rules, so it does not authorize an ad hoc script.
