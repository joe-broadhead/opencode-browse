---
name: browse-capture
description: Record, capture or replay a browser session with browse: screen recordings, a rolling flight recorder, a redacted HAR of an authenticated flow, or a reusable secret profile. Use when the deliverable is a video, a HAR, or an API flow captured from the user's own browser.
---

# Captures: recordings, network, secret profiles

Captures are real page content: a recording shows whatever is on the tab, and a HAR holds request and response bodies.
Credential-bearing fields become references (`${BC_SECRET_N}`, `${BC_REDACTED_N}`), not values, but everything else —
names, addresses, messages, personal data — stays in clear. Write artifacts outside the repository.

All three capture tools run without asking (owner ruling, 2026-11-07). That does not make them free: say in one
sentence what will be captured and where it will be written before the call, and tell the user what the result holds.
If the user wants them to ask or stay off, they add a later rule for that agent — `browse_network`,
`browse_recording` or `browse_flight_recorder` with `"effect": "ask"` or `"deny"`.

Get the exact inputs from `search()` in Code Mode before the first call; never guess a field.

## Recording the tab

`browse_recording` with `action: "start"` needs `outputPath` (`.webm` or `.mp4`). `mode` is `auto` (tab capture for a
tab the user lent, CDP for an agent tab), `tab-capture` or `cdp`. Audio exists only in tab-capture mode; CDP mode needs
`ffmpeg` on the relay's machine. Then `action: "stop"` finalizes it; `action: "cancel"` discards it.

Recordings show only the page by default. A handoff during a recording shows a system notification instead of the card.
For a demo video ask for `cursor: true`, and tell the user the cursor appears in the frame — a page can detect it.

Inspect the file you produced (open it, or check its size and duration) before reporting it as done. Report the
viewport and the path you actually tested.

## The flight recorder

`browse_flight_recorder` keeps a rolling in-memory buffer (`retentionMs`, default 60000, at most 120000) so a failure
that is hard to reproduce can be saved after it happens: `action: "start"`, reproduce, then `action: "save_last"` with a
fresh `outputPath` and a `durationMs` no longer than the retention. `cancel` discards the buffer.

## Capturing an API flow

1. `browse_network` `action: "start"` with `session`, a `urlFilter` such as `/api/`, and `resourceTypes: ["fetch",
   "xhr"]`. Bodies are embedded by default; limits are `maxBodyBytes`, `maxTotalBodyBytes`, `maxEntries` and
   `maxDurationMs` (30 minutes by default, and the capture also ends when this MCP server exits).
2. Do the flow in `execute`.
3. `browse_network` `action: "stop"` with `outputPath` (the redacted HAR) and/or `secrets` (a profile name). One of the
   two is required; `cancel` discards the capture.

Capture a flow at least twice with different inputs when you need to tell constants from parameters. Inspect the
redacted HAR, write one typed request per observed flow, then verify each with a harmless live call.

A capture blocks sensitive authenticated requests while it runs, and leaving one running is a privacy cost: stop it
as soon as the flow is done.

## Secret profiles

`browse_secrets_status` shows a profile's references, source and expiry without values. `browse_secrets_refresh`
reloads the page, observes fresh credentials and updates the profile while keeping the references stable.

`browse_secrets_run` runs a local command with the profile's real values in `BC_SECRET_N` environment variables. Its
output is redacted, but the child process can send what it holds. Run only a command you wrote or trust, and tell the
user which command, with which profile, and where its output goes. Prefer `secrets_run` over writing a credential into
a file or a script.

## What not to do

- Never capture a page the user did not ask about, and never leave a capture or a recording running "just in case".
- Never write an artifact into the repository or a folder that is committed.
- Never put a captured value into a message, a commit, a test fixture or a script.
- Never record a tab that is showing a payment, a password manager or a private message without saying so first.
