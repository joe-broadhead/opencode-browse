// browse's built extension, shipped at the pinned version: verify the shipped files against manifest/extension.json,
// copy them to the managed profile's folder, point the copy at this relay's port, and leave the one-time pairing file
// browse's own unpacked build reads.
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { browseError } from "../constants.js"
import { extensionDir, relayPort } from "./paths.js"

export interface ExtensionPin {
  readonly version: string
  readonly zip: { readonly url: string; readonly sha256: string; readonly bytes: number }
  readonly files: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[]
}

/**
 * The Chrome extension id browse's own relay accepts for an unpacked build, derived from browse's public manifest key.
 * The store zip ships no `key`, so the pinned copy carries browse's public one; otherwise Chrome derives an id from
 * the folder path and the relay refuses the extension's WebSocket origin.
 */
export const UNPACKED_EXTENSION_ID = "afeafocngkodbmaipcngoamamfmekgfo"

/** Chrome's id for an unpacked extension: sha256 of the DER key, first 16 bytes, each nibble as a-p. */
export function extensionIdOf(key: string): string | undefined {
  try {
    const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest()
    let id = ""
    for (let index = 0; index < 16; index++) id += String.fromCharCode(97 + (digest[index]! >> 4)) + String.fromCharCode(97 + (digest[index]! & 15))
    return id
  } catch {
    return undefined
  }
}

export const readExtensionPin = (manifestDir: string): ExtensionPin =>
  JSON.parse(readFileSync(join(manifestDir, "extension.json"), "utf8")) as ExtensionPin

/** True when every shipped file matches its recorded digest and there is no extra file. */
export function verifyExtension(directory: string, pin: ExtensionPin): string | undefined {
  const seen = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const name = relative(directory, path).split(sep).join("/")
        seen.add(name)
        const expected = pin.files.find((file) => file.path === name)
        if (expected === undefined) return `${name} is not part of the pinned extension`
        const data = readFileSync(path)
        if (data.length !== expected.bytes) return `${name} is ${data.length} bytes, the pin says ${expected.bytes}`
        if (createHash("sha256").update(data).digest("hex") !== expected.sha256) return `${name} does not match its pinned SHA-256`
      }
    }
    return undefined
  }
  if (!existsSync(directory)) return "the extension is missing"
  const problem = walk(directory)
  if (problem !== undefined) return problem
  const missing = pin.files.filter((file) => !seen.has(file.path))
  if (missing.length > 0) return `${missing[0]!.path} is missing`
  try {
    const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as { key?: unknown }
    if (typeof manifest.key !== "string" || extensionIdOf(manifest.key) !== UNPACKED_EXTENSION_ID) return "manifest.json does not carry the key the relay expects"
  } catch {
    return "manifest.json could not be read"
  }
  return undefined
}

/**
 * Copies the pinned extension into the managed folder and points its hard-coded relay port at this relay. The copy is
 * what Chromium loads unpacked; the package's own copy is never modified.
 */
export function prepareExtension(packageRoot: string, pin: ExtensionPin): string {
  const source = join(packageRoot, "managed-extension")
  const problem = verifyExtension(source, pin)
  if (problem !== undefined) {
    throw browseError("EXTENSION_UNVERIFIED", `The bundled browse extension does not match its pin (${problem}), so managed mode will not load it.`, "Reinstall the plugin.")
  }
  const destination = extensionDir()
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true })
  const port = relayPort()
  for (const entry of readdirSync(destination, { recursive: true })) {
    const file = join(destination, String(entry))
    if (!/\.(js|json)$/.test(file) || !existsSync(file)) continue
    const text = readFileSync(file, "utf8")
    if (text.includes("19988")) writeFileSync(file, text.replaceAll("19988", String(port)))
  }
  return destination
}

/**
 * Writes the one-time pairing file browse's unpacked build reads (`relay-pairing.json`, fetched by the extension with
 * `chrome.runtime.getURL`). It is used once: the extension exchanges the code for its own key at the relay. The file is
 * owner-only and removed as soon as the pairing attempt ends.
 */
export function writePairingCode(directory: string, code: string) {
  writeFileSync(join(directory, "relay-pairing.json"), `${JSON.stringify({ code })}\n`, { mode: 0o600 })
}

export function clearPairingCode(directory: string) {
  rmSync(join(directory, "relay-pairing.json"), { force: true })
}

/** The extension's own version, from its manifest. */
export function extensionVersion(directory: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as { version?: string }).version
  } catch {
    return undefined
  }
}
