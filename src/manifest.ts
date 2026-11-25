import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { packageRoot } from "./package.js"

/** The installed `capabilities` manifest, read from the package beside `dist/`. */
const installed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { readonly version: string; readonly capabilities: Manifest }

export const manifest: Manifest = installed.capabilities
export const packageVersion: string = installed.version
