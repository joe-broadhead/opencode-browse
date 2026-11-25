// The plugin's entry: one `register` call wires every method through the contract's doors (contract §9); the browse
// provider registers the MCP server, resolves the pinned binary and starts the managed browser; the commands and the
// skills are host surfaces, not methods. `assertHost` runs first, so an untested release leaves nothing half-wired.
import { Plugin } from "@opencode/plugin"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { registerDoctorCommand, registerInstallCommands, registerStatusCommand, registerStopRelayCommand } from "./commands.js"
import { createHandlers } from "./handlers/index.js"
import { manifest, packageVersion } from "./manifest.js"
import { parseOptions } from "./options.js"
import { createProvider } from "./provider/index.js"
import { applyScopeNarrowing } from "./scope.js"
import { registerSkills } from "./skills.js"

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(ctx) {
    assertHost(ctx, manifest)

    const parsed = parseOptions(ctx.options)
    const provider = await createProvider(ctx, manifest, parsed)
    try {
      const handlers = createHandlers({ manifest, version: packageVersion, hostVersion: ctx.app.version, report: provider.report })
      const registration = await register(ctx, manifest, handlers)

      // The scoped profile narrows the contract's rules; it runs after `register` so its rules come after them.
      if (provider.options !== undefined) await applyScopeNarrowing(ctx, manifest, provider.options, (problem) => provider.note(problem))
      await registerSkills(ctx.skill, provider.skills)
      await registerStatusCommand(ctx, manifest, provider)
      await registerDoctorCommand(ctx, provider)
      if (provider.options !== undefined) await registerInstallCommands(ctx, provider)
      await registerStopRelayCommand(ctx, { binary: () => provider.binary })

      return async () => {
        await registration.dispose()
        await provider.dispose()
      }
    } catch (error) {
      await provider.dispose()
      throw error
    }
  },
})
