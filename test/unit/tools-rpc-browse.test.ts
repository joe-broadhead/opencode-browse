import { describe, expect, test } from "bun:test"
import { METHODS, NEXT_STEPS, PLUGIN_ID, TOOLS_RPC_ID, pluginError } from "../../src/host/tools-rpc.js"
import { TOOLS } from "../../src/browse-tools.js"

describe("browse.tools", () => {
  test("is browse.tools, and every known tool is a method with its class", () => {
    expect(PLUGIN_ID).toBe("browse")
    expect(TOOLS_RPC_ID).toBe("browse.tools")
    expect(METHODS).toHaveLength(18)
    expect(METHODS.map((method) => ({ name: method.name, class: method.class }))).toEqual(TOOLS.map((tool) => ({ name: tool.name, class: tool.class })))
    for (const method of METHODS) expect(method.kind).toBe("mcp")
  })

  test("every next step is one sentence ending in a full stop", () => {
    for (const [code, next] of Object.entries(NEXT_STEPS)) {
      expect({ code, next }).toEqual({ code, next: expect.stringMatching(/^[A-Z].*\.$/) })
    }
  })

  test("a browse error is mapped, and anything else is not", () => {
    expect(pluginError(Object.assign(new Error("x"), { code: "BINARY_UNVERIFIED", nextStep: "Reinstall the plugin." }))).toEqual({ code: "BINARY_UNVERIFIED", what: "Browse refused the call.", next: "Reinstall the plugin." })
    expect(pluginError(new Error("x"))).toBeUndefined()
    expect(pluginError(undefined)).toBeUndefined()
  })
})
