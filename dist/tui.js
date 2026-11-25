// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";

// src/redact.ts
var SECRETS = [
  [/\b(bearer|basic|token)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b([\w-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|signature|credential)["']?\s*[:=]\s*)["']?[^\s"'&,;]+["']?/gi, "$1[redacted]"],
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, "[redacted]"],
  [/\b(?:tvly|sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abposr]|lin_api|lin_oauth)[-_][\w-]{8,}/gi, "[redacted]"],
  [/[\w+=-]{40,}/g, "[redacted]"]
];
var REASON_LIMIT = 160;
var CONTROLS = /[\u0000-\u001f\u007f-\u009f]+/g;
var BIDI = /[‎‏‪-‮⁦-⁩]/g;
var withoutUrlSecrets = (text) => text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/^(https?:\/\/)[^/?#@]*@/i, "$1").replace(/[?#].*$/s, ""));
var oneLine = (text) => text.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
function cut(text, limit) {
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : text;
}
function shortReason(text) {
  const reason = oneLine(SECRETS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), withoutUrlSecrets(text))).replace(/[.\s]+$/, "");
  if (reason === "") return void 0;
  return cut(reason, REASON_LIMIT);
}

// src/tui.ts
import { createSignal } from "solid-js";

// src/constants.ts
var SERVER_NAME = "browse";
var errorText = (code, message, nextStep) => `${code}: ${message} Next step: ${nextStep}`;

// src/provider/recording.ts
function formatRecording(recording) {
  if (recording === void 0) return "checking";
  const { ffmpeg, toolbar } = recording;
  const agent = ffmpeg.found ? `agent tabs: ffmpeg ${ffmpeg.version ?? "found"}${ffmpeg.path ? ` (${ffmpeg.path})` : ""}` : "agent tabs: ffmpeg missing";
  return `${agent} \xB7 lent tabs: toolbar-click backend${toolbar.ready ? "" : " unavailable"}`;
}

// src/report.ts
var strings = { type: "array", items: { type: "string" } };
var count = { type: "integer", minimum: 0 };
var nullableString = { type: ["string", "null"] };
var nullableBoolean = { type: ["boolean", "null"] };
var STATE_TEXT = {
  connected: "connected",
  connecting: "connecting",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
  host_untested: "host untested"
};
function sourceText(source) {
  if (source.type === "plugin") return `${source.command}, registered by this plugin`;
  if (source.type === "adopted") return `${source.command}, your own mcp.servers.${SERVER_NAME}, used with the pinned binary`;
  return `your mcp.servers.${SERVER_NAME} points at ${source.command}`;
}
function binaryText({ binary }) {
  const { path, version, source, verified, tested } = binary;
  if (path === null) return "none";
  const flags = [verified ? "verified at startup" : "unverified", tested ? "pinned" : "untested"].join(", ");
  const origin = source === "option" ? "your path option" : source === "environment" ? "the test seam" : "the release";
  return `browse ${version ?? "unknown version"} (${flags}; ${origin}) \xB7 ${path}`;
}
function extensionText({ extension }) {
  if (extension.connected) return `paired and connected${extension.version ? ` \xB7 ${extension.version}` : ""}${extension.compatible === false ? " \xB7 protocol incompatible" : ""}`;
  if (extension.pairingState === "unpaired") return "not paired";
  if (extension.pairingState) return `not connected (${extension.pairingState})`;
  return "not connected";
}
function relayText({ relay }) {
  if (!relay.running) return "stopped";
  return `running${relay.version ? ` \xB7 ${relay.version}` : ""}${relay.stale ? " \xB7 stale build" : ""} \xB7 auto-update off`;
}
function managedText({ managed }) {
  if (managed === void 0) return void 0;
  const chromium = managed.chromium.path === null ? `none${managed.chromiumPin ? ` (pinned Chrome for Testing ${managed.chromiumPin.version}${managed.chromiumPin.supported ? "" : ", no build for this platform"})` : ""}` : `Chrome for Testing ${managed.chromium.version} (${managed.chromium.verified ? "verified" : "unverified, your own"}; ${managed.chromium.source}) \xB7 ${managed.chromium.path}`;
  const running = managed.state === "running" && managed.pid !== null ? ` \xB7 pid ${managed.pid}${managed.headless ? " \xB7 headless" : " \xB7 headed"}` : "";
  return `${managed.state}${running} \xB7 extension ${managed.extension.version ?? "unknown"} \xB7 ${chromium}`;
}
var ACCESS_TEXT = (status) => `${status.access.run} run \xB7 ${status.access.ask} ask \xB7 ${status.access.off} off; option access is "${status.accessMode}"`;
function toolsText({ tools, unknownCount, unknownTools }) {
  if (unknownCount === 0) return `${tools} available, 0 unknown`;
  const more = unknownCount - unknownTools.length;
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : "";
  return `${tools} available, ${unknownCount} unknown${names} (an unknown tool runs on the agent's own rules)`;
}
function formatReport(status) {
  const scope = status.scope ? `Scope: ${status.scope.session}${status.scope.readOnly ? " (read-only)" : ""}${status.scope.allowedOrigins.length ? ` \xB7 ${status.scope.allowedOrigins.join(", ")}` : " \xB7 no allowlist"}${status.scope.matches ? "" : " \xB7 drifted or unknown"}` : void 0;
  const managed = managedText(status);
  const details = [status.error, status.source && sourceText(status.source), status.legacy ? "an older opencode-browser server is configured and denied" : void 0].filter(Boolean).join("; ");
  return [
    "Browse status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Mode: ${status.mode === "managed" ? "managed browser" : "real browser (the Web Store extension)"}`,
    `- Access: ${ACCESS_TEXT(status)}`,
    `- Browser: ${binaryText(status)}`,
    ...managed ? [`- Managed: ${managed}`] : [],
    `- Relay: ${relayText(status)}`,
    `- Extension: ${extensionText(status)}`,
    `- Recording: ${formatRecording(status.recording)}`,
    ...scope ? [`- ${scope}`] : [],
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${status.unguardedAgents.length ? status.unguardedAgents.join(", ") : "none"}`,
    `- OpenCode: ${status.host.version ?? "unknown version"} (${status.host.tested ? "tested" : "untested"}; supported range ${status.host.range})${status.problems.length ? `. ${status.problems.join(" ")}` : ""}`,
    `- Next step: ${status.nextStep}`
  ].join("\n");
}
var REPORT_SCHEMA = {
  type: "object",
  required: ["version", "state", "mode", "legacy", "host", "binary", "relay", "extension", "tools", "unknownCount", "unknownTools", "unguardedAgents", "access", "problems", "updates", "nextStep"],
  properties: {
    version: { type: "string" },
    state: { enum: ["connected", "connecting", "failed", "disabled", "not_configured", "conflict", "host_untested"] },
    mode: { enum: ["real", "managed"] },
    legacy: { type: "boolean" },
    error: { type: "string" },
    source: {
      type: "object",
      required: ["type"],
      properties: { type: { enum: ["plugin", "adopted", "conflict"] }, command: { type: "string" }, expected: { type: "string" } }
    },
    host: {
      type: "object",
      required: ["version", "range", "tested"],
      properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } }
    },
    binary: {
      type: "object",
      required: ["path", "version", "source", "verified", "tested", "supported"],
      properties: {
        path: nullableString,
        version: nullableString,
        source: { enum: ["package", "option", "environment", null] },
        verified: { type: "boolean" },
        tested: { type: "boolean" },
        supported: { type: "boolean" }
      }
    },
    relay: {
      type: "object",
      required: ["running", "version", "stale"],
      properties: { running: { type: "boolean" }, version: nullableString, stale: { type: "boolean" } }
    },
    extension: {
      type: "object",
      required: ["connected", "version", "pairingState", "compatible", "nextStep"],
      properties: { connected: { type: "boolean" }, version: nullableString, pairingState: nullableString, compatible: nullableBoolean, nextStep: nullableString }
    },
    recording: {
      type: "object",
      required: ["ffmpeg", "toolbar"],
      properties: {
        ffmpeg: {
          type: "object",
          required: ["found", "path", "version"],
          properties: { found: { type: "boolean" }, path: nullableString, version: nullableString }
        },
        toolbar: { type: "object", required: ["ready"], properties: { ready: { type: "boolean" } } }
      }
    },
    managed: {
      type: "object",
      required: ["state", "chromium", "extension", "profile", "pid", "headless", "lastError"],
      properties: {
        state: { enum: ["stopped", "starting", "running", "not_installed", "failed"] },
        chromium: {
          type: "object",
          required: ["path", "version", "source", "verified"],
          properties: { path: nullableString, version: nullableString, source: { enum: ["installed", "option", null] }, verified: { type: "boolean" } }
        },
        chromiumPin: {
          type: "object",
          required: ["version", "supported"],
          properties: { version: { type: "string" }, supported: { type: "boolean" }, bytes: { type: "integer", minimum: 0 } }
        },
        extension: {
          type: "object",
          required: ["version", "directory"],
          properties: { version: nullableString, directory: nullableString }
        },
        profile: { type: "string" },
        pid: { type: ["integer", "null"] },
        headless: { type: "boolean" },
        lastError: nullableString
      }
    },
    scope: {
      type: "object",
      required: ["session", "readOnly", "allowedOrigins", "matches"],
      properties: { session: { type: "string" }, readOnly: { type: "boolean" }, allowedOrigins: strings, matches: { type: "boolean" } }
    },
    tools: count,
    unknownCount: count,
    unknownTools: strings,
    unguardedAgents: strings,
    access: {
      type: "object",
      required: ["run", "ask", "off"],
      properties: { run: count, ask: count, off: count }
    },
    problems: strings,
    updates: {
      type: "object",
      required: ["autoUpdate", "available"],
      properties: { autoUpdate: nullableString, available: nullableString }
    },
    nextStep: { type: "string" }
  }
};
var ReportRpc = {
  id: "browse",
  methods: {
    report: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: REPORT_SCHEMA
    }
  },
  events: {}
};

// src/tui.ts
var TUI_ID = "browse.tui";
var TITLE = "Browse status";
var KEYS = "r refresh \xB7 esc close";
function viewMessage(result) {
  return `${reportOf(result)}

${KEYS}`;
}
function reportOf(result) {
  if ("status" in result) return formatReport(result.status).split("\n").slice(1).join("\n");
  const { error } = result;
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : void 0;
  if (type === "unavailable") {
    const { message, data } = error;
    if (typeof message === "string" && typeof data?.nextStep === "string") return `${message} Next step: ${data.nextStep}`;
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return errorText("STATUS_UNAVAILABLE", "The Browse plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.");
  }
  const reason = shortReason(typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error));
  return errorText("STATUS_UNAVAILABLE", `Could not read Browse's status${reason ? ` (${reason})` : ""}.`, "Restart OpenCode, then run /browse again.");
}
function setupView(context) {
  let open;
  let latest = 0;
  let stops = [];
  const unsubscribe = () => {
    for (const stop of stops.splice(0)) stop();
  };
  const subscribe = () => {
    if (stops.length) return;
    stops = [
      context.data.on("mcp.status.changed", (event) => {
        if (event.data.server === SERVER_NAME) refresh();
      }),
      // Status events can be missed while the TUI is reconnecting.
      context.data.on("server.connected", refresh),
      context.data.on("agent.updated", refresh)
    ];
  };
  const [shown, setShown] = createSignal(false);
  const show = async (refresh2) => {
    if (refresh2 && open === void 0) return;
    const request = ++latest;
    const location = context.location;
    const result = await context.client.rpc(ReportRpc).report({}, location ? { location } : {}).then((status) => ({ status }), (error) => ({ error }));
    if (request !== latest || refresh2 && open === void 0) return;
    open = request;
    setShown(true);
    subscribe();
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request) return;
      open = void 0;
      setShown(false);
      unsubscribe();
    });
    context.ui.dialog.set({ size: "large" });
  };
  const refresh = () => void show(true);
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "browse.status",
        title: "Browse: Status",
        description: "Sign-in, account, tools and the next step for Browse",
        group: "Browse",
        palette: true,
        slash: { name: "browse" },
        run: () => show(false)
      },
      { id: "browse.status.refresh", title: "Refresh Browse status", group: "Browse", bind: "r", enabled: shown, run: refresh }
    ]
  }));
  return () => {
    unsubscribe();
    if (open === void 0) return;
    open = void 0;
    setShown(false);
    context.ui.dialog.clear();
  };
}
var tui_default = Plugin.define({ id: TUI_ID, setup: setupView });
export {
  tui_default as default,
  setupView,
  viewMessage
};
