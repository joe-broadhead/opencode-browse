import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

describe("the Jelly declaration", () => {
  test("has every key Jelly reads, and no unknown ones", () => {
    expect(Object.keys(pkg.jelly).sort()).toEqual(["contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"].sort())
    expect(pkg.jelly.title).toBe("Browse")
    expect(pkg.jelly.summary.length).toBeLessThan(160)
    expect(pkg.jelly.icon).toBe("assets/icon.svg")
    expect(pkg.jelly.signIns).toEqual([])
    expect(pkg.jelly.views).toEqual([])
    expect(pkg.jelly.rpc).toEqual([])
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

  test("declares the vendor, because browse is not our product", () => {
    expect(pkg.opencode.vendor).toEqual({ id: "anomaly", name: "Anomaly", domain: "opencode.ai" })
  })
})
