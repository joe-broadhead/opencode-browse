# Accounts

Browse signs in to nothing. It is a local plugin: there is no provider account, no integration, no OAuth flow and no
`accounts` option.

- The manifest has no `accounts` key, so every method is declared `accounts: "none"` and takes no `account` field. A
  call that passes one is refused with `INPUT_INVALID`.
- `status` lists no accounts. `NO_ACCOUNTS` is an empty list, never an invented `default`.
- There is no `probe`: a probe reports a signed-in owner, and browse has none.

If a call needs a person's identity, it is the identity of the browser profile they are signed in to — which the browse
tools read, and which this plugin never asks a person to share with it.
