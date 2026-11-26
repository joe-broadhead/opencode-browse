// The release tarball ships NOTICE next to bundles that inline third-party code. This test builds both entries with the
// same externals as scripts/build.mjs, collects the packages that actually end up in the bundles (including packages
// inlined by plugin-contract's bundled dist), and requires each one's verbatim licence text in NOTICE.
import { describe, expect, test } from "bun:test"
import { build } from "esbuild"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const HOST = ["@opencode/plugin", "@opencode/plugin/*", "@opentui/*", "solid-js", "solid-js/*"]
const PLUGIN = "@we-the-rebel-alliance/browse-plugin"

const version = {
  name: "version",
  setup(editor: { onLoad(options: { filter: RegExp }, callback: () => { contents: string; loader: "ts" }): void }) {
    editor.onLoad({ filter: /[\\/]src[\\/]version\.ts$/ }, () => {
      const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
      return { contents: `export const VERSION = ${JSON.stringify(version)}`, loader: "ts" }
    })
  },
}

/** A package name from an esbuild input path, or undefined for the plugin's own sources. */
function packageOf(path: string): string | undefined {
  return /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)?.[1]
}

function keep(name: string | undefined): name is string {
  return name !== undefined && name !== PLUGIN && !HOST.some((host) => (host.endsWith("/*") ? name.startsWith(host.slice(0, -1)) : name === host)) && !name.startsWith(".")
}

/** The licence file a package ships, or undefined when it ships none. */
function licenceFile(directory: string): string | undefined {
  const files = readdirSync(directory)
  return files.find((file) => /^licen[cs]e$/i.test(file)) ?? files.find((file) => /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(file))
}

/** Every package esbuild actually inlines into either bundle, plus the two the metafile does not name. */
async function bundledPackages(): Promise<{ packages: string[]; code: string }> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: { index: "src/index.ts", tui: "src/tui.ts" },
    outdir: "dist",
    bundle: true,
    splitting: false,
    format: "esm",
    platform: "node",
    target: "es2023",
    external: HOST,
    banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` },
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
    write: false,
    plugins: [version as never],
  })
  const found = new Set<string>()
  const inputs = Object.keys(result.metafile.inputs)
  for (const path of inputs) {
    const name = packageOf(path)
    if (keep(name)) found.add(name)
  }
  // A bundled dist can inline its own dependencies; plugin-contract's chunks carry the original module path in a
  // comment (`// node_modules/zod/v4/...`). Those packages are redistributed by this bundle too.
  for (const path of inputs) {
    if (!path.startsWith("node_modules/")) continue
    const text = readFileSync(join(root, path), "utf8")
    for (const match of text.matchAll(/\/\/\s*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g)) {
      if (keep(match[1])) found.add(match[1])
    }
  }
  const code = (result.outputFiles ?? []).map((file) => file.text).join("\n")
  // RD-106: zod is inlined by plugin-contract's pre-bundled dist, not listed as its own input, so detect its code.
  if (/\$ZodType|ZodError/.test(code)) found.add("zod")
  // plugin-contract is inlined by every plugin; accept either its input path or its register code.
  if (found.has("@we-the-rebel-alliance/plugin-contract") || code.includes("SCHEMA_VIOLATION")) found.add("@we-the-rebel-alliance/plugin-contract")
  return { packages: [...found].sort(), code }
}

function heading(name: string, version: string, licence: string): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^## ${escape(name)} ${escape(version)} \\(${escape(licence)}\\)`, "m")
}

describe("the bundled third-party notices", () => {
  test("every bundled package has its heading and verbatim licence text", async () => {
    const { packages, code } = await bundledPackages()
    expect(code, "zod's code is in the bundle").toMatch(/\$ZodType|ZodError/)
    expect(packages).toEqual(expect.arrayContaining(["@we-the-rebel-alliance/plugin-contract", "yaml", "zod"]))
    const notice = readFileSync(join(root, "NOTICE"), "utf8")
    for (const name of packages) {
      const directory = join(root, "node_modules", name)
      const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { version: string; license: string }
      const file = licenceFile(directory)
      expect(file, `${name} ships a licence file`).toBeDefined()
      expect(notice, `${name} heading`).toMatch(heading(name, pkg.version, pkg.license))
      expect(notice, `${name} licence text`).toContain(readFileSync(join(directory, file!), "utf8").trim())
    }
  })

  test("the package ships NOTICE", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files: string[] }
    expect(pkg.files).toContain("NOTICE")
  })
})
