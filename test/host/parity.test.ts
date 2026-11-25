// Parity with v0.0.5, on the real OpenCode 2.4.1 host after load: every old browse MCP tool name, both skills, all five
// commands, the status method (now status + report), the MCP server, every agent's rules, and the local identity. The
// old `browse.tools` RPC is deliberately not carried by contract v0 and is recorded in the PR and CHANGELOG, not here.
import "./isolate.js"
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { evaluate } from "@we-the-rebel-alliance/plugin-contract/access"
import { startHost } from "./harness.js"
import { ReportRpc } from "../../src/report.js"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const fixture = JSON.parse(readFileSync(join(repo, "test", "fixtures", "live-tools.json"), "utf8")) as { tools: { name: string }[] }
const oldTools = fixture.tools.map((tool) => tool.name).sort()
const oldCommands = ["browse-status", "browse-doctor", "browse-install", "browse-install-browser", "browse-stop-relay"]
const shipped = (): string[] =>
  readdirSync(join(repo, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

describe("parity with v0.0.5 on the real host", () => {
  test("the old tools, skills, commands, status, agents, MCP server and local identity are all present", async () => {
    const host = await startHost({ options: { verifyBinary: false } })
    try {
      // 1. The 18 MCP tool names (status is the plugin's own tool now; the server's status is shadowed) plus report.
      const tools = (await host.probe().tool.list()).filter((tool) => tool.options?.namespace === "browse")
      const names = tools.map((tool) => tool.name).sort()
      expect(names.filter((name) => !oldTools.includes(name))).toEqual(["report"])
      for (const name of oldTools) expect(names).toContain(name)
      expect(tools.find((tool) => tool.id === "browse_status")?.options?.permission).toBe("browse.status")
      expect(tools.find((tool) => tool.id === "browse_report")?.options?.permission).toBe("browse.report")
      // The server's tools are registered by OpenCode's MCP layer, not a plugin tool transform, so their permission
      // action lives in the access rules (asserted on every agent below); the ids and names are the old ones.
      for (const name of oldTools.filter((name) => name !== "status")) expect(tools.find((tool) => tool.id === `browse_${name}`)?.name).toBe(name)

      // 2. Both skills, derived from the skills/ directories.
      const skills = (await host.probe().skill.list()) as { data: { id: string }[] }
      const ids = skills.data.map((skill) => skill.id)
      for (const name of shipped()) expect(ids).toContain(name)

      // 3. All five commands.
      const commands = (await host.probe().command.list()) as { data: { name: string }[] }
      const commandNames = commands.data.map((command) => command.name)
      for (const name of oldCommands) expect(commandNames).toContain(name)

      // 4. Every agent gets the old tool actions and the plugin's own methods at access all.
      const agents = (await host.probe().agent.list()) as { data: { id: string; permissions: { action: string; resource: string; effect: string }[] }[] }
      expect(agents.data.length).toBeGreaterThan(0)
      for (const agent of agents.data) {
        if (evaluate(agent.permissions as never, "*", "*") === "deny") continue
        for (const name of oldTools) expect({ agent: agent.id, action: `browse_${name}`, effect: evaluate(agent.permissions as never, `browse_${name}`, "*") }).toEqual({ agent: agent.id, action: `browse_${name}`, effect: "allow" })
        expect(evaluate(agent.permissions as never, "browse.status", "*")).toBe("allow")
        expect(evaluate(agent.permissions as never, "browse.report", "*")).toBe("allow")
      }

      // 5. Status (the contract's) and report (the old detailed status), and the local identity: no accounts.
      const status = await host.call("status", {})
      expect(status.ok).toBe(true)
      if (status.ok) {
        expect(status.output).toMatchObject({ name: "browse", version: "0.0.0", accounts: [] })
        expect((status.output as { state?: string }).state).toMatch(/^(ready|needs_sign_in|error)$/)
      }
      let report = await host.call("report", {})
      // The recording check is asynchronous at setup; the report carries it once it has answered.
      for (let attempt = 0; attempt < 100 && !(report.ok && (report.output as { recording?: unknown }).recording !== undefined); attempt++) {
        await Bun.sleep(25)
        report = await host.call("report", {})
      }
      expect(report.ok).toBe(true)
      if (report.ok) {
        expect(report.output).toMatchObject({ version: "0.0.0", mode: "real" })
        expect((report.output as { tools?: number }).tools).toBe(19)
        expect((report.output as { recording?: unknown }).recording).toBeDefined()
        expect((report.output as { binary?: unknown }).binary).toBeDefined()
        expect((report.output as { relay?: unknown }).relay).toBeDefined()
        expect((report.output as { extension?: unknown }).extension).toBeDefined()
      }

      // 6. The MCP server is registered, and the TUI is kept and reads report over the same RPC id.
      const servers = await host.client.mcp.list({ location: host.location })
      expect(servers.data.find((server) => server.name === "browse")?.status.status).toBe("connected")
      expect(ReportRpc.id).toBe("browse")
      expect(Object.keys(ReportRpc.methods)).toEqual(["report"])
      expect(existsSync(join(repo, "dist", "tui.js"))).toBe(true)
    } finally {
      await host.close()
    }
  }, 120_000)
})
