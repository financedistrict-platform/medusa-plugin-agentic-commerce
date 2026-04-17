import { describe, it, expect } from "vitest"
import { normalizeCountryCode, isValidCountryInput } from "../lib/country-codes"

describe("normalizeCountryCode", () => {
  describe("alpha-2 passthrough", () => {
    it("lowercases alpha-2 codes", () => {
      expect(normalizeCountryCode("IT")).toBe("it")
      expect(normalizeCountryCode("DE")).toBe("de")
      expect(normalizeCountryCode("us")).toBe("us")
    })

    it("trims whitespace", () => {
      expect(normalizeCountryCode(" IT ")).toBe("it")
    })
  })

  describe("alpha-3 conversion", () => {
    it("converts common alpha-3 codes to alpha-2", () => {
      expect(normalizeCountryCode("ITA")).toBe("it")
      expect(normalizeCountryCode("DEU")).toBe("de")
      expect(normalizeCountryCode("USA")).toBe("us")
      expect(normalizeCountryCode("GBR")).toBe("gb")
      expect(normalizeCountryCode("DNK")).toBe("dk")
      expect(normalizeCountryCode("SGP")).toBe("sg")
    })

    it("case-insensitive alpha-3", () => {
      expect(normalizeCountryCode("ita")).toBe("it")
      expect(normalizeCountryCode("Ita")).toBe("it")
    })

    it("returns null for unknown alpha-3", () => {
      expect(normalizeCountryCode("XYZ")).toBeNull()
    })
  })

  describe("country name conversion", () => {
    it("converts full country names", () => {
      expect(normalizeCountryCode("Italy")).toBe("it")
      expect(normalizeCountryCode("Germany")).toBe("de")
      expect(normalizeCountryCode("United States")).toBe("us")
      expect(normalizeCountryCode("United Kingdom")).toBe("gb")
    })

    it("case-insensitive names", () => {
      expect(normalizeCountryCode("ITALY")).toBe("it")
      expect(normalizeCountryCode("italy")).toBe("it")
    })

    it("handles common aliases", () => {
      expect(normalizeCountryCode("UK")).toBe("gb")
      expect(normalizeCountryCode("USA")).toBe("us")
      expect(normalizeCountryCode("UAE")).toBe("ae")
    })

    it("returns null for unknown names", () => {
      expect(normalizeCountryCode("Atlantis")).toBeNull()
    })
  })

  describe("edge cases", () => {
    it("returns null for undefined/null/empty", () => {
      expect(normalizeCountryCode(undefined)).toBeNull()
      expect(normalizeCountryCode(null)).toBeNull()
      expect(normalizeCountryCode("")).toBeNull()
      expect(normalizeCountryCode("   ")).toBeNull()
    })

    it("returns null for non-alpha single character", () => {
      expect(normalizeCountryCode("I")).toBeNull()
    })
  })
})

describe("isValidCountryInput", () => {
  it("returns true for any resolvable input", () => {
    expect(isValidCountryInput("IT")).toBe(true)
    expect(isValidCountryInput("ITA")).toBe(true)
    expect(isValidCountryInput("Italy")).toBe(true)
  })

  it("returns false for unresolvable input", () => {
    expect(isValidCountryInput("XYZ")).toBe(false)
    expect(isValidCountryInput("Atlantis")).toBe(false)
    expect(isValidCountryInput(undefined)).toBe(false)
  })
})
