# Scripts

The plugin exposes `browse.tools`, one method per known browse tool, so a script can call them with no model.

```
POST /api/rpc/browse.tools/<method>
{ "input": { "sessionID": "ses_…", "input": <the tool's input> } }
```

`describe` lists every method with its class and, given a session, the permission the call would get:

```sh
curl -s http://127.0.0.1:49374/api/rpc/browse.tools/describe \
  -H 'content-type: application/json' \
  -d '{"input":{"sessionID":"ses_…"}}'
```

## Methods

| Method | Class | Default |
| --- | --- | --- |
| `status` | read | allow |
| `session_list` | read | allow |
| `secrets_list` | read | allow |
| `secrets_status` | read | allow |
| `tabs_cleanup` | destructive | allow |
| `session_new` | write | ask |
| `session_use` | write | ask |
| `session_adopt` | write | ask |
| `session_reset` | destructive | ask |
| `session_delete` | destructive | ask |
| `settings` | write | ask |
| `execute` | destructive | ask |
| `secrets_run` | destructive | ask |
| `secrets_refresh` | destructive | ask |
| `session_allowlist` | destructive | ask |
| `network` | export | allow |
| `recording` | export | allow |
| `flight_recorder` | export | allow |

Only `allow` runs. An `ask` is refused with `PERMISSION_DENIED` and no prompt, because a script cannot answer one; a
`deny` is refused and the method is absent from the agent's tool list. A saved "Always allow" does not authorize a
script: a script's grant is a rule in config, or a Jobs run session.

**The three captures run by default, and a script can start one with no model turn and no prompt.** That is a
deliberate default, and it is worth weighing before you grant a script a session:

- `network` captures authenticated request and response **headers and bodies** from the user's logged-in session
  (credential-bearing fields become references, the rest is in clear) and writes a redacted HAR to a path the script
  chooses.
- `recording` records the real tab's **pixels**, and its **audio** in tab-capture mode, to a path the script chooses.
- `flight_recorder` keeps a rolling buffer of the tab's pixels and `save_last` writes a clip to a path the script
  chooses.

The artifacts stay where the script writes them, for as long as the file exists. To make them ask or turn them off for
one agent, add a later rule — a script's `ask` is refused, so `deny` is the useful one:

```json
{ "agents": { "build": { "permissions": [
  { "action": "browse_network", "resource": "*", "effect": "deny" },
  { "action": "browse_recording", "resource": "*", "effect": "deny" },
  { "action": "browse_flight_recorder", "resource": "*", "effect": "deny" }
] } } }
```

So with the defaults a script can read the status, list sessions and secrets, clean up tabs and capture. It cannot
drive a page, change a session, widen an allowlist, or run a command with your credentials. If you allow a method
explicitly, remember that `browse_execute` gives a script the same reach the model would have had.

## Results and errors

An MCP result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts
joined by newlines.

A refusal is the RPC error `failed` with `data: { code, next }`:

| Code | When |
| --- | --- |
| `PERMISSION_DENIED` | the rule resolves to ask, or a deny hides the tool |
| `SESSION_UNKNOWN` | the session does not exist in this location |
| `SESSION_AGENT_REQUIRED` | the session names no agent |
| `TOOL_UNAVAILABLE` | OpenCode does not list the tool now |
| `UPSTREAM_ERROR` | browse returned an error; its first line, redacted and cut to 300 characters |

## Example

```sh
curl -s http://127.0.0.1:49374/api/rpc/browse.tools/session_list \
  -H 'content-type: application/json' \
  -d '{"input":{"sessionID":"ses_…","input":{}}}'
```
