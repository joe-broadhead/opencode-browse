import { browseError, SUPPORTED_HOST, TESTED_HOSTS } from "./constants.js"

/** OpenCode's version as status reports it: the `host` fields every plugin of this family shares. */
export interface HostCheck {
  /** OpenCode's version, or null when it reports none. */
  readonly version: string | null
  /** The supported range, `opencode.host` in package.json. */
  readonly range: string
  /** True only for a release every check runs on (TESTED_HOSTS). */
  readonly tested: boolean
}

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/
const parse = (version: string) => RELEASE.exec(version)?.slice(1).map(Number)
const [LOWEST, ABOVE] = SUPPORTED_HOST.split(" ").map((bound) => parse(bound.replace(/^[<>]=?/, ""))!)
const compare = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!

/** True for a release inside the supported range. Prereleases, dev builds and unparsable versions are outside it. */
export function isSupportedHost(version: string) {
  const parts = parse(version)
  return parts !== undefined && compare(parts, LOWEST!) >= 0 && compare(parts, ABOVE!) < 0
}

/** True only for a release every check runs on. */
export const isTestedHost = (version: string) => TESTED_HOSTS.includes(version)

/**
 * Starts on any release inside the supported range; status calls only the tested ones "tested". Refuses a host outside
 * the range unless the user opted in, in which case status says so.
 */
export function checkHost(version: string, allowUntestedHost: boolean): HostCheck {
  if (!isSupportedHost(version) && !allowUntestedHost) {
    throw browseError(
      "HOST_UNTESTED",
      `This plugin supports OpenCode ${SUPPORTED_HOST}, found ${version || "no version"}.`,
      `Use OpenCode ${SUPPORTED_HOST}, or set the plugin option "allowUntestedHost": true to run anyway.`,
    )
  }
  return { version: version === "" ? null : version, range: SUPPORTED_HOST, tested: isTestedHost(version) }
}
