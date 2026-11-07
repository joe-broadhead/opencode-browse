// Where managed mode keeps its things. The browser profile and the extension copy live in this plugin's data folder,
// so they are separate from the user's own browser; the Chrome for Testing download lives in the cache and can be
// deleted at any time. The relay token is browse's own, in browse's data root.
import { homedir } from "node:os"
import { join } from "node:path"

const xdg = (variable: string, fallback: readonly string[]) => process.env[variable] ?? join(homedir(), ...fallback)

/** This plugin's data folder: `$XDG_DATA_HOME/opencode-browse`, or `~/.local/share/opencode-browse`. */
export const dataRoot = () => join(xdg("XDG_DATA_HOME", [".local", "share"]), "opencode-browse")
/** This plugin's cache: `$XDG_CACHE_HOME/opencode-browse`, or `~/.cache/opencode-browse`. */
export const cacheRoot = () => join(xdg("XDG_CACHE_HOME", [".cache"]), "opencode-browse")

export const managedRoot = () => join(dataRoot(), "managed")
/** The managed browser's own profile. Its logins are separate from the user's browser. */
export const profileDir = () => join(managedRoot(), "profile")
/** The unpacked extension copy, with its one-time pairing file while pairing. */
export const extensionDir = () => join(managedRoot(), "extension")
/** The running browser's record, so a crash leaves a pid this plugin can recognise. */
export const statePath = () => join(managedRoot(), "browser.json")

/** browse's own data root, where the relay token and pairing codes live. */
export const browseDataRoot = () => process.env.OPENCODE_BROWSER_HOME ?? join(xdg("XDG_DATA_HOME", [".local", "share"]), "browse")
export const relayTokenPath = () => join(browseDataRoot(), "relay-token")

/** The relay's port: browse's default 19988, or `OPENCODE_BROWSER_PORT`. */
export const relayPort = () => {
  const value = Number(process.env.OPENCODE_BROWSER_PORT)
  return Number.isInteger(value) && value > 0 && value < 65_536 ? value : 19988
}
