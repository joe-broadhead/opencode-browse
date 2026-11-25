# Automations

Browse declares no events source and emits no bus events, so there is no cursor to keep and no timer recipe to
generate.

A person who wants scheduled browser work uses an OpenCode automation whose prompt asks an agent to do the work with
the `browse` tools. The plugin reports its state through `tools.browse.status` (the short contract answer) and
`tools.browse.report` (the diagnostic report), which an automation can read before it starts; it never starts a browser
by itself.

The rule that a plugin has no per-request hook holds here: browse reads its binary, relay and extension when a report
is asked for, and keeps a three-second cache so a status read and a doctor run close together do not shell out twice.
