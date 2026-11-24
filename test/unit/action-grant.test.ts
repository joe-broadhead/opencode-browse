// The action-grant verifier kept for the contract's `grant` module: a signed, single-use grant bound to one action and
// its exact input. The format is the host's published one (a compact EdDSA JWS), and every refusal is by message.
import { describe, expect, test } from "bun:test"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import {
  actionAudience,
  actionGrantVerifier,
  actionInputDigest,
  ActionGrantRefused,
  canonicalJson,
  publishedActionKey,
  ACTION_KEY_SYMBOL,
  type ActionPublicKey,
} from "../../src/grant/action-grant.js"

const PACKAGE = "@we-the-rebel-alliance/browse-plugin"
const AUDIENCE = actionAudience(PACKAGE)
const NOW = 1_800_000_000
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const KEY: ActionPublicKey = { kid: createHash("sha256").update("grant-test").digest("base64url"), jwk: publicKey.export({ format: "jwk" }) as ActionPublicKey["jwk"] }

/** A grant as the host signs one, with any claim or header overridden. */
function grant(action: string, input: unknown, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = privateKey) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const head = part({ alg: "EdDSA", typ: "jelly-act+jwt", kid: KEY.kid, ...header })
  const body = part({ iss: "hst_test", aud: AUDIENCE, act: action, in: actionInputDigest(input), dev: "dev_test", mbr: "acc_test", cls: "local", iat: NOW, exp: NOW + 60, jti: randomBytes(16).toString("base64url"), ...claims })
  return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), key).toString("base64url")}`
}

const verifier = (key: ActionPublicKey | undefined = KEY, now = NOW) => actionGrantVerifier({ audience: AUDIENCE, key: () => key, now: () => now })
const verify = (action: string, input: unknown, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = privateKey) =>
  verifier().verify(action, { input, grant: grant(action, input, claims, header, key) })

describe("canonical JSON and the input digest", () => {
  test("sorts keys, leaves undefined members out, and nests", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], c: { d: 2, e: undefined } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"d":2}}')
    expect(canonicalJson(undefined)).toBe("null")
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]')
  })

  test("hashes the canonical JSON, so key order does not change the digest", () => {
    expect(actionInputDigest({ b: 2, a: 1 })).toBe(actionInputDigest({ a: 1, b: 2 }))
    expect(actionInputDigest({ a: 1 })).not.toBe(actionInputDigest({ a: 2 }))
    expect(actionInputDigest(null)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe("a valid grant", () => {
  test("is accepted once, for exactly its action and input, and returns its claims", () => {
    const input = { id: "ask_1" }
    const claims = verify("browser.connect", input)
    expect(claims).toMatchObject({ iss: "hst_test", aud: AUDIENCE, act: "browser.connect", in: actionInputDigest(input), dev: "dev_test", mbr: "acc_test", cls: "local", iat: NOW, exp: NOW + 60 })
    expect(claims.jti).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  test("a second use of the same jti is refused, and a new grant is not", () => {
    const input = {}
    const signed = grant("browser.stop", input)
    const verifier = actionGrantVerifier({ audience: AUDIENCE, key: () => KEY, now: () => NOW })
    expect(verifier.verify("browser.stop", { input, grant: signed }).act).toBe("browser.stop")
    expect(() => verifier.verify("browser.stop", { input, grant: signed })).toThrow("The grant was used already.")
    expect(verifier.verify("browser.stop", { input, grant: grant("browser.stop", input) }).act).toBe("browser.stop")
  })
})

describe("what a grant may not be", () => {
  test("another plugin, action or input", () => {
    expect(() => verify("browser.stop", {}, { aud: "other#engine" })).toThrow("The grant is for another plugin.")
    expect(() => verify("browser.stop", {}, { act: "browser.connect" })).toThrow("The grant is for another action.")
    expect(() => verify("browser.stop", {}, { in: actionInputDigest({ other: true }) })).toThrow("The grant is for another input.")
  })

  test("another host's key, kid, algorithm or type", () => {
    const other = generateKeyPairSync("ed25519").privateKey
    expect(() => verify("browser.stop", {}, {}, {}, other)).toThrow("The grant's signature is not the host's.")
    expect(() => verify("browser.stop", {}, {}, { kid: "another" })).toThrow("The grant is not one of this host's action grants.")
    expect(() => verify("browser.stop", {}, {}, { alg: "RS256" })).toThrow("The grant is not one of this host's action grants.")
    expect(() => verify("browser.stop", {}, {}, { typ: "JWT" })).toThrow("The grant is not one of this host's action grants.")
    const noKey = actionGrantVerifier({ audience: AUDIENCE, key: () => undefined, now: () => NOW })
    expect(() => noKey.verify("browser.stop", { input: {}, grant: grant("browser.stop", {}) })).toThrow("jelly handed this engine no action key.")
  })

  test("expired, issued in the future, or longer-lived than a minute", () => {
    expect(() => verify("browser.stop", {}, { iat: NOW - 120, exp: NOW - 60 })).toThrow("The grant has expired.")
    expect(() => verify("browser.stop", {}, { iat: NOW + 60, exp: NOW + 120 })).toThrow("The grant's times are not a grant's.")
    expect(() => verify("browser.stop", {}, { exp: NOW + 61 })).toThrow("The grant's times are not a grant's.")
    expect(() => verify("browser.stop", {}, { iat: undefined })).toThrow("The grant has no times.")
  })

  test("a class that is not chat or local, a short jti, or a missing claim", () => {
    expect(() => verify("browser.stop", {}, { cls: "admin" })).toThrow("The grant has no class.")
    expect(() => verify("browser.stop", {}, { jti: "short" })).toThrow("The grant's id is too short.")
    for (const claim of ["iss", "aud", "act", "in", "dev", "mbr"]) {
      expect(() => verify("browser.stop", {}, { [claim]: undefined }), claim).toThrow(`The grant has no ${claim}.`)
      expect(() => verify("browser.stop", {}, { [claim]: "" }), claim).toThrow(`The grant has no ${claim}.`)
    }
  })

  test("not a compact JWS, or not JSON inside it", () => {
    const verifier = actionGrantVerifier({ audience: AUDIENCE, key: () => KEY, now: () => NOW })
    for (const value of [undefined, 1, {}, "", "a.b", "a.b.c.d"]) {
      expect(() => verifier.verify("browser.stop", { input: {}, grant: value }), String(value)).toThrow(ActionGrantRefused)
    }
    expect(() => verifier.verify("browser.stop", { input: {}, grant: "not-json.not-json.not-json" })).toThrow("The grant cannot be read.")
  })
})

test("the key the host publishes in the engine is read, and nothing else", () => {
  expect(publishedActionKey({})).toBeUndefined()
  expect(publishedActionKey({ [ACTION_KEY_SYMBOL]: { kid: 1 } } as never)).toBeUndefined()
  expect(publishedActionKey({ [ACTION_KEY_SYMBOL]: KEY } as never)).toEqual(KEY)
})
