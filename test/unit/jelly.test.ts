import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ACCESS_VALUES } from "../../src/browse-tools.js"
import { parseOptions } from "../../src/options.js"
import { ACCESS_CHOICES, type PluginSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

describe("the Jelly declaration", () => {
  test("has every key Jelly reads, and no unknown ones", () => {
    expect(Object.keys(pkg.jelly).sort()).toEqual(["actions", "contributes", "icon", "inbox", "nativeData", "notices", "rpc", "signIns", "skills", "summary", "title", "tools", "views"].sort())
    expect(pkg.jelly.title).toBe("Browse")
    expect(pkg.jelly.summary.length).toBeLessThanOrEqual(120)
    expect(pkg.jelly.icon).toBe("assets/icon.svg")
    expect(pkg.jelly.signIns).toEqual([])
    expect(pkg.jelly.skills).toEqual(["browse", "browse-capture"])
  })

  test("declares the 18 tools with the same effects and read-only flags as the table", async () => {
    const { TOOLS } = await import("../../src/browse-tools.js")
    expect(pkg.jelly.tools).toHaveLength(18)
    for (const tool of TOOLS) {
      const entry = pkg.jelly.tools.find((item: { name: string }) => item.name === `browse.${tool.name}`)
      expect(entry, tool.name).toEqual({ name: `browse.${tool.name}`, permission: `browse_${tool.name}`, effect: tool.effect, readOnly: tool.readOnly })
    }
  })

  test("the icon is the same file in both declarations, and all three ship", () => {
    expect(pkg.jelly.icon).toBe(pkg.opencode.icons[0].src)
    for (const icon of pkg.opencode.icons) expect(pkg.files).toContain(icon.src)
    for (const asset of ["./icon.svg", "./icon-128.png", "./icon-256.png"]) expect(pkg.exports[asset]).toBeDefined()
  })

  test("declares the personal-browser binding exactly as jelly's D103 example, with every-time local actions", async () => {
    const { ACTIONS, REQUEST_ACTIONS, REQUEST_INPUT, STATUS_OUTPUT, NATIVE_VIEW, NativeRpc, CONNECT_INPUT, STOP_INPUT } = await import("../../src/jelly/native.js")
    // B1: the hint names connect and stop only; jelly's PluginNativeDataSchema.actions is strict.
    expect(pkg.jelly.nativeData).toEqual([{ v: 1, capability: "personal-browser", view: NATIVE_VIEW, read: "browser.status", actions: { connect: "browser.connect", stop: "browser.stop" } }])
    expect(ACTIONS).toEqual({ connect: "browser.connect", stop: "browser.stop" })
    const view = pkg.jelly.views.find((item: { id: string }) => item.id === NATIVE_VIEW)
    expect(view).toEqual({ v: 1, id: NATIVE_VIEW, place: "settings-section", title: "Your Chrome", page: "views/browser.html", grants: ["rpc"], rpc: ["browser.status", "browser.ask"] })
    expect(pkg.files).toContain("views")
    // B2: the read declares jelly's shape. B3: allow and decline are ordinary local, every-time actions of the page.
    expect(pkg.jelly.rpc.find((item: { name: string }) => item.name === "browser.status").output).toEqual(STATUS_OUTPUT)
    expect(Object.keys(STATUS_OUTPUT.properties).sort()).toEqual(["agent", "canControl", "request", "state", "task"])
    for (const name of [REQUEST_ACTIONS.allow, REQUEST_ACTIONS.decline]) {
      expect(pkg.jelly.actions.find((item: { name: string }) => item.name === name).input, name).toEqual(REQUEST_INPUT)
    }
    for (const name of [ACTIONS.connect, ACTIONS.stop, REQUEST_ACTIONS.allow, REQUEST_ACTIONS.decline]) {
      const action = pkg.jelly.actions.find((item: { name: string }) => item.name === name)
      expect(action, name).toMatchObject({ target: "engine", class: "local", confirm: "always", views: [NATIVE_VIEW], personOnly: "consent" })
      // The engine method jelly calls is act.<name>, under the package's own RPC id.
      expect(Object.keys(NativeRpc.methods)).toContain(`act.${name}`)
    }
    expect(pkg.jelly.actions.find((item: { name: string }) => item.name === ACTIONS.connect).input).toEqual(CONNECT_INPUT)
    expect(pkg.jelly.actions.find((item: { name: string }) => item.name === ACTIONS.stop).input).toEqual(STOP_INPUT)
    for (const method of pkg.jelly.rpc) {
      expect(method.readOnly).toBe(true)
      expect(Object.keys(NativeRpc.methods)).toContain(method.name)
    }
    expect(NativeRpc.id).toBe(pkg.name)
    expect(pkg.jelly.inbox).toEqual({ method: "browser.inbox" })
    const { ASK_NOTICE, CHANGE_NOTICE } = await import("../../src/jelly/native.js")
    // B4's change notice is not declared while it is not raised (RAISE_CHANGE_NOTICES is false).
    const { RAISE_CHANGE_NOTICES } = await import("../../src/jelly/native.js")
    expect(RAISE_CHANGE_NOTICES).toBe(false)
    expect(pkg.jelly.notices).toEqual([{ id: ASK_NOTICE, label: "Your Chrome", category: "request", preview: "line" }])
    expect(pkg.jelly.notices.map((notice: { id: string }) => notice.id)).not.toContain(CHANGE_NOTICE)
  })

  test("declares the access and browser settings, with Jelly's own words for access, and nothing else", () => {
    expect(pkg.jelly.contributes).toEqual({
      homeFeeds: [],
      homeWidgets: [],
      workKinds: [],
      settings: [
        {
          key: "access",
          label: "Access",
          type: "string",
          description: expect.any(String),
          choices: ACCESS_CHOICES,
          default: parseOptions({}).access,
        },
        {
          key: "browser",
          label: "Browser",
          type: "string",
          description: expect.any(String),
          choices: [
            { value: "real", label: "Your browser", description: expect.any(String) },
            { value: "managed", label: "Separate browser", description: expect.any(String) },
          ],
          default: parseOptions({}).browser,
        },
      ],
    })
  })

  test("the settings follow Jelly's rules for a declared setting", () => {
    expect(settingsProblems(pkg.jelly.contributes.settings)).toEqual([])
  })

  test("the options parser takes every value of each declared closed set, its default included, and refuses a value outside it", () => {
    const settings = pkg.jelly.contributes.settings as PluginSetting[]
    const values = (key: string) => (settingChoices(settings.find((entry) => entry.key === key)!) ?? []).map((choice) => choice.value)
    expect(values("access")).toEqual([...ACCESS_VALUES])
    expect(values("browser")).toEqual(["real", "managed"])
    for (const setting of settings) {
      const key = setting.key as "access" | "browser"
      for (const value of values(key)) expect<string>(parseOptions({ [key]: value })[key]).toBe(value)
      expect<string>(parseOptions({})[key]).toBe(setting.default as string)
      expect(settingValueIssue(setting, "write")).not.toBeNull()
      expect(() => parseOptions({ [key]: "write" })).toThrow(`The option "${key}" must be`)
    }
  })

  test("declares the vendor, because browse is not our product", () => {
    expect(pkg.opencode.vendor).toEqual({ id: "anomaly", name: "Anomaly", domain: "anoma.ly", mark: true })
  })
})
