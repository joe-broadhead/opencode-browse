# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this package's `package.json` as
JSON, without loading the plugin, when a person reviews the exact version, and uses it as follows.

Jelly names the plugin **Browse** (`jelly.title`), with the package name and version beneath. Under that name it shows
the one line in `jelly.summary`, and beside it the mark in `jelly.icon` (`assets/icon.svg`, shipped in the package):
Jelly reads that file once, when it records the plugin, and keeps it only if it is a clean SVG of drawing elements,
with no script, style, link or outside reference. The mark is the family's **Neutral slate** tile — a browser window
with a pointer, drawn by us — and not Anomaly's, OpenCode's or any browser's mark.

## Icons and vendor

`jelly.icon` stays `assets/icon.svg`, and `opencode.icons` declares the same mark three ways, in MCP's `Icon` shape:
the clean SVG (`sizes: ["any"]`), a 128×128 PNG and a 256×256 PNG, each with its `mimeType` and a relative `src` inside
the package. `opencode.icons[0].src` equals `jelly.icon`, so the two declarations cannot drift. `exports` exposes the
three files as `./icon.svg`, `./icon-128.png` and `./icon-256.png`, and all three ship in the tarball.

`opencode.vendor` is `{ "id": "anomaly", "name": "Anomaly", "domain": "opencode.ai" }`: the service behind the plugin
is Anomaly's browse, whose product page and installer live on `opencode.ai`. A display app that has decided to show the
vendor's official mark reads the domain and fetches it from the vendor's own site, under the vendor's terms; the
official mark never passes through this package, its tarball or a CDN. The package carries no vendor marks, colours or
letterforms.

## Tools and permissions

18 tools are declared (4 read-only): the reads, the tab cleanup and the three captures run; the page action, the
session tools, the settings and the three tools that act with your credentials ask; none of the known 18 is off. A tool
browse adds later is not declared here, and Jelly does not ask about it; this plugin's own rules deny it until a
release classifies it.

Jelly's agents have no base "allow everything" rule, so this plugin's default rules, which it puts after that rule,
never reach them. Jelly writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow` changes nothing in
Jelly.

- Ask: `browse_execute` (the whole page-action surface), `browse_session_new`, `browse_session_use`,
  `browse_session_adopt`, `browse_session_reset`, `browse_session_delete`, `browse_session_allowlist`,
  `browse_settings`, `browse_secrets_run` and `browse_secrets_refresh`.
- Run: `browse_status`, `browse_session_list`, `browse_secrets_list`, `browse_secrets_status`, `browse_tabs_cleanup`,
  `browse_network`, `browse_recording`, `browse_flight_recorder`.

So a Jelly agent cannot drive the browser at all unless the person allows `browse_execute`; a person who allows it
should expect every page action to be approved one call at a time. Captures run, and they write real page content, so
a person who does not want that should turn `browse_network`, `browse_recording` and `browse_flight_recorder` off in
that agent's settings.

## Sign-in

None. There is no account, no OAuth and no `/connect` entry: the browser is paired locally with the relay, in the
browser's own options page. `jelly.signIns` is empty.

## Views and Home feeds

None.
