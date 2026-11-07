# Configuration

## Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `path` | string | unset | Use your own browse binary instead of the pinned one. Reported unverified, and untested unless it is the pinned version. |
| `scope` | object | unset | Pin the MCP server to one browse session. See below. |
| `scope.session` | string | `opencode` | The session's id: lowercase letters, digits, `.`, `_`, `-`. |
| `scope.allowedOrigins` | string[] | `[]` | Hosts or origins the session's tabs may load: `example.com`, `*.example.com`, `https://app.example.com`, `http://localhost:3000`. Empty means no allowlist, browse's own default. |
| `scope.readOnly` | boolean | `false` | Pin a read-only session, whose input the relay refuses. `execute` then runs without asking. |
| `verifyBinary` | boolean | `true` | Check the pinned binary's SHA-256 against its platform package before running it. |
| `allowUntestedHost` | boolean | `false` | Run on an OpenCode version outside `>=2.2.3 <2.3.0`, with a warning in status. |

An unknown option, a wrong type or an unsafe session name is `OPTIONS_INVALID`: the plugin sets nothing up and status
shows the problem and the fix.

## Scoped mode

With `scope` set, at setup the plugin runs the vendor CLI with an argument list:

1. `session list --json`;
2. `session new <id> [--read-only] [--allow-origin <host>…]` when it does not exist;
3. `session delete <id>` then `session new` when only the read-only flag differs, because browse cannot change it in
   place;
4. `session allow --session <id> <hosts…>`, or `--clear`, when the origins differ.

Then the MCP entry carries `OPENCODE_BROWSER_SESSION=<id>`, and the rule block becomes the strict one:

| Tool | Default profile | Scoped profile |
| --- | --- | --- |
| `session_new`, `session_use`, `session_adopt`, `session_delete` | ask | **deny** |
| `session_allowlist` | ask | **deny** |
| `execute` | ask | **allow** when `scope.readOnly`, else ask |
| everything else | as the table in the README | unchanged |

`/browse-status` compares the live session with the option and says `drifted` when they differ; `/browse-doctor`
re-applies the scope.

A deleted session is recreated by the next `execute` without a scope. In the scoped profile `session_delete` is denied,
so that needs you; the next status read reports `SCOPE_LOST` and the doctor repairs it.

## Permissions

The block, as `/browse-status` prints it, is `src/permissions.ts` evaluated: `browse_*` deny first, then one rule per
known tool. The owner's ruling of 2026-11-07 gives 8 allows, 10 asks and no denies among the 18.

To turn a capture off for one agent:

```json
{ "agents": { "build": { "permissions": [{ "action": "browse_recording", "resource": "*", "effect": "deny" }] } } }
```

To let an agent drive a page without a prompt, in one project only, prefer the scoped read-only profile over an
`allow` on `browse_execute`: `allow` also reaches scripts and unattended runs.

A tool browse adds later matches only `browse_*` and is therefore **denied**. To allow one before this plugin
classifies it, add an exact rule with `allow`; status keeps naming it as unknown.

## Errors

Every error is `CODE: What happened. Next step: What to do.` One next step, ending with a full stop.

| Code | When | Next step |
| --- | --- | --- |
| `BINARY_MISSING` | the platform package has no binary, or `path` names a missing file | reinstall the plugin, or fix `path` |
| `BINARY_UNVERIFIED` | the binary's SHA-256 differs from its manifest | reinstall; set `verifyBinary: false` only if you trust the file |
| `UNSUPPORTED_PLATFORM` | no package ships for this OS or architecture | set `path` to your own browse binary |
| `SERVER_CONFLICT` | `mcp.servers.browse` is not a browse server | remove or rename the entry, then restart |
| `SERVER_LEGACY` | an `opencode-browser` entry remains | remove it, then restart |
| `SERVER_NOT_REGISTERED` | the server transform failed | restart OpenCode |
| `RULES_NOT_ADDED` | the rules could not be inserted | restart OpenCode |
| `SCOPE_LOST` | the pinned session is missing or differs | run `/browse-doctor` |
| `SCOPE_UNREACHABLE` | the session could not be created (relay down, CLI error) | pair the browser, then run `/browse-doctor` |
| `STATUS_UNAVAILABLE` | `browse status` did not answer | run `browse status` in a terminal, then press `r` |
| `DOCTOR_FAILED` | the vendor doctor exited non-zero | read its checks, fix the first failure |
| `HOST_UNTESTED` | OpenCode is outside the supported range | use a supported OpenCode, or set `allowUntestedHost` |
| `OPTIONS_INVALID` | an option failed validation | fix the option the message names |
| `SKILLS_INVALID` | a bundled skill could not load | reinstall the plugin |

## Status and RPC

`browse/status` returns the model behind `/browse-status` and `/browse`:

```
{ version, host { version, range, tested }, state, unguardedAgents, nextStep,
  binary { path, version, source, verified, tested, supported },
  relay { running, version, stale },
  extension { connected, version, pairingState, compatible, nextStep },
  scope? { session, readOnly, allowedOrigins, matches },
  tools, unknownCount, unknownTools, access { run, ask, off },
  problems, updates { autoUpdate, available } }
```

`state` is one of `connected`, `connecting`, `failed`, `disabled`, `not_configured`, `conflict`, `host_untested`.
`sign_in_required` never applies: browse has no account, and the `Account` row is omitted.
