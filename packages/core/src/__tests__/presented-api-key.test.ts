import { describe, it, expect } from "vitest"
import { presentedApiKey } from "../lib/presented-api-key"

describe("presentedApiKey", () => {
  it("reads the key from x-api-key", () => {
    expect(presentedApiKey({ "x-api-key": " k " })).toBe("k")
  })

  it("reads the key from a bearer authorization header", () => {
    expect(presentedApiKey({ authorization: "Bearer k" })).toBe("k")
  })

  it("returns the same key when both headers carry it", () => {
    expect(presentedApiKey({ "x-api-key": "k", authorization: "Bearer k" })).toBe("k")
  })

  it("treats an empty x-api-key as absent", () => {
    expect(presentedApiKey({ "x-api-key": "  " })).toBeUndefined()
    expect(presentedApiKey({ "x-api-key": "", authorization: "Bearer k" })).toBe("k")
  })

  it("returns undefined when neither header is present", () => {
    expect(presentedApiKey({})).toBeUndefined()
    expect(presentedApiKey({ authorization: "Basic abc" })).toBeUndefined()
  })
})
