# Security

Browse runs a browser, so the security page is mostly about what the browser can reach and what leaves the machine.

## What leaves the machine

- The pinned binary's download: a size and SHA-256 check against the release manifest and the upstream pin. Nothing
  else is fetched by this plugin.
- Managed mode's Chrome for Testing and extension: the same rule, pinned by SHA-256 and size.
- The browse server talks to the browse extension over the loopback relay. This plugin makes no other network call; it
  has no analytics, no update check in the plugin process, and no telemetry.
- `browse`'s own auto-update is turned off for the server this plugin runs, so the pinned file cannot be replaced under
  it.

## Scopes and credentials

Browse signs in to nothing: no integration, no OAuth, no token held by this plugin. The browser profile's cookies are
the person's, and the browse server owns them. `secrets_list`, `secrets_status`, `secrets_run` and `secrets_refresh`
work with the browse server's stored site secrets; the plugin never reads a value, and `network` redacts captured
credentials to `${BC_SECRET_N}` / `${BC_REDACTED_N}` references.

## The binary

Only the binary its release pins is run:

- the release manifest must name the same executable as the upstream pin, by size and SHA-256;
- the cached file must be a regular file, not a link, with owner read and execute and no permission outside `0755`;
- the file is re-hashed at every use when `verifyBinary` is on (the default);
- a `path` option is the person's own binary: it is reported unverified and untested, and is never hashed against the
  pin. Choose it only for a binary you built or trust.

The MCP wrapper (`bin/mcp.mjs`) re-verifies the pin at every spawn, so a stale file never reaches the server.

## Redaction

Every reason the plugin shows is one line, at most 160 characters, with URL query strings and fragments dropped,
`Bearer`/`Basic` values, JWTs and token-shaped words replaced, and control characters removed. `status` uses the
contract's `redactReason`; the diagnostic report uses the same shapes. No credential, token or query string is written
to status, the dialog, a log or a session message.

## Permissions

- The contract's `access` module generates the rules from `methods` and `access`; the plugin adds no default rule of its
  own. `src/scope.ts` only narrows (`deny`/`ask`) when a session is pinned.
- A non-read method over RPC needs a permission ask or a valid action grant. Browse declares no non-read methods of its
  own, so its RPC methods are reads; the 18 browser tools are the MCP server's and keep their own rules.
- An agent that lacks the generated rules is named in status; the plugin never patches it behind the person's back.

## Untrusted content

Page content, the browse server's answers and the vendor doctor's text are data. They are never followed as
instructions, never used to choose a tool or a recipient, and never echoed into status beyond a redacted one-line
reason. The skills say the same to an agent.
