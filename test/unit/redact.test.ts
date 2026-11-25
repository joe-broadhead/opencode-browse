import { describe, expect, test } from "bun:test"
import { cut, oneLine, shortReason } from "../../src/redact.js"

// The shapes are assembled at run time: the test's source says what each part is, and the secret detector that scans
// the repository reads a description rather than a credential-shaped line.
const url = ["https://user", ":", "pass@example.com/p?token=abc#frag"].join("")
const line = ["bad token", "=abc12345", "\u0007 api_key: k-", "1234567890 Authorization: Bearer eyJhbGciOi", ".eyJzdWIiOi.c2ln"].join("")

describe("redaction", () => {
  test("keeps a URL's scheme, host and path, and drops credentials, query and fragment", () => {
    expect(shortReason(`see ${url}`)).toBe("see https://example.com/p")
  })

  test("removes token shapes and control characters", () => {
    const reason = shortReason(line)!
    for (const secret of ["abc12345", "k-1234567890", "eyJhbGciOi"]) expect(reason).not.toContain(secret)
    expect(reason).not.toContain("\u0007")
  })

  test("one line, cut between whole characters", () => {
    expect(oneLine("a\n\nb\tc")).toBe("a b c")
    expect(cut("😀😀😀", 2)).toBe("😀…")
    expect(shortReason("   ")).toBeUndefined()
  })
})
