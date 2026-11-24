import { createHash, createPublicKey, verify } from "node:crypto"

/**
 * The check of a jelly action grant, written from jelly's published format (ADR 0023 section 4): a compact JWS with
 * the header `{ alg: "EdDSA", typ: "jelly-act+jwt", kid }` and the claims `iss`, `aud` (`<package>#engine`), `act`,
 * `in` (base64url SHA-256 of the input's canonical JSON), `dev`, `mbr`, `cls`, `iat`, `exp` (at most 60 s after
 * `iat`) and `jti`. jelly publishes the public half of its action key in the engine at
 * `globalThis[Symbol.for("jelly.action-key")]` as `{ kid, jwk }`. A grant allows one action, with exactly that input,
 * once, for a minute: the verifier spends each `jti`.
 */

export const ACTION_GRANT_TYPE = "jelly-act+jwt"
export const ACTION_GRANT_SECONDS = 60
export const ACTION_KEY_SYMBOL = Symbol.for("jelly.action-key")
const CLOCK_SKEW_SECONDS = 5

export interface ActionPublicKey {
  readonly kid: string
  readonly jwk: { readonly kty: "OKP"; readonly crv: "Ed25519"; readonly x: string }
}

export interface ActionGrantClaims {
  readonly iss: string
  readonly aud: string
  readonly act: string
  readonly in: string
  readonly dev: string
  readonly mbr: string
  readonly cls: "chat" | "local"
  readonly iat: number
  readonly exp: number
  readonly jti: string
}

export class ActionGrantRefused extends Error {
  override readonly name = "ActionGrantRefused"
}

/** One JSON value as one string (RFC 8785): keys sorted by UTF-16 code units, undefined members left out. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`
}

export function actionInputDigest(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input ?? null)).digest("base64url")
}

export const actionAudience = (pkg: string) => `${pkg}#engine`

/** The key jelly published in this engine, if any. */
export function publishedActionKey(holder: Record<symbol, unknown> = globalThis as Record<symbol, unknown>): ActionPublicKey | undefined {
  const value = holder[ACTION_KEY_SYMBOL] as ActionPublicKey | undefined
  return value !== undefined && typeof value === "object" && typeof value.kid === "string" ? value : undefined
}

/** One verifier per plugin instance: a second one would not know the first one's spent grants. */
export function actionGrantVerifier(options: { readonly audience: string; readonly key: () => ActionPublicKey | undefined; readonly now?: () => number }) {
  const spent = new Map<string, number>()
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  return {
    verify(action: string, call: { readonly input: unknown; readonly grant: unknown }): ActionGrantClaims {
      const key = options.key()
      if (key === undefined) throw new ActionGrantRefused("jelly handed this engine no action key.")
      const at = now()
      const claims = checkGrant(call.grant, key, at)
      if (claims.aud !== options.audience) throw new ActionGrantRefused("The grant is for another plugin.")
      if (claims.act !== action) throw new ActionGrantRefused("The grant is for another action.")
      if (claims.in !== actionInputDigest(call.input)) throw new ActionGrantRefused("The grant is for another input.")
      for (const [jti, exp] of spent) if (exp + CLOCK_SKEW_SECONDS < at) spent.delete(jti)
      if (spent.has(claims.jti)) throw new ActionGrantRefused("The grant was used already.")
      spent.set(claims.jti, claims.exp)
      return claims
    },
  }
}

function checkGrant(grant: unknown, key: ActionPublicKey, at: number): ActionGrantClaims {
  if (typeof grant !== "string") throw new ActionGrantRefused("The call carries no grant.")
  const parts = grant.split(".")
  if (parts.length !== 3) throw new ActionGrantRefused("The grant is not a compact JWS.")
  const [header, payload, signature] = parts as [string, string, string]
  const head = json(header)
  if (head.alg !== "EdDSA" || head.typ !== ACTION_GRANT_TYPE || head.kid !== key.kid) throw new ActionGrantRefused("The grant is not one of this host's action grants.")
  let signed = false
  try {
    signed = verify(null, Buffer.from(`${header}.${payload}`), createPublicKey({ key: { ...key.jwk }, format: "jwk" }), Buffer.from(signature, "base64url"))
  } catch {
    signed = false
  }
  if (!signed) throw new ActionGrantRefused("The grant's signature is not the host's.")
  const claims = json(payload)
  const text = (name: string) => {
    const value = claims[name]
    if (typeof value !== "string" || value === "") throw new ActionGrantRefused(`The grant has no ${name}.`)
    return value
  }
  const { iat, exp, cls } = claims
  if (typeof iat !== "number" || typeof exp !== "number") throw new ActionGrantRefused("The grant has no times.")
  if (exp - iat > ACTION_GRANT_SECONDS || iat > at + CLOCK_SKEW_SECONDS) throw new ActionGrantRefused("The grant's times are not a grant's.")
  if (exp + CLOCK_SKEW_SECONDS < at) throw new ActionGrantRefused("The grant has expired.")
  if (cls !== "chat" && cls !== "local") throw new ActionGrantRefused("The grant has no class.")
  const jti = text("jti")
  if (jti.length < 22) throw new ActionGrantRefused("The grant's id is too short.")
  return { iss: text("iss"), aud: text("aud"), act: text("act"), in: text("in"), dev: text("dev"), mbr: text("mbr"), cls, iat, exp, jti }
}

function json(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"))
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // Said below.
  }
  throw new ActionGrantRefused("The grant cannot be read.")
}
