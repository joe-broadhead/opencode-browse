import { describe, expect, test } from "bun:test"
import { cut, oneLine, shortReason } from "../../src/redact.js"

describe("redaction", () => {
  test("keeps a URL's scheme, host and path, and drops credentials, query and fragment", () => {
    expect(shortReason("see https://user:pass@example.com/p?token=abc#frag")).toBe("see https://example.com/p")
  })

  test("removes token shapes and control characters", () => {
    const line = shortReason("bad token=abc12345\u0007 api_key: k-1234567890 Authorization: Bearer eyJhbGciOi.eyJzdWIiOi.c2ln")!
    for (const secret of ["abc12345", "k-1234567890", "eyJhbGciOi"]) expect(line).not.toContain(secret)
    expect(line).not.toContain("\u0007")
  })

  test("one line, cut between whole characters", () => {
    expect(oneLine("a\n\nb\tc")).toBe("a b c")
    expect(cut("😀😀😀", 2)).toBe("😀…")
    expect(shortReason("   ")).toBeUndefined()
  })
})
