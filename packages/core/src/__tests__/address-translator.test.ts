import { describe, it, expect } from "vitest"
import { ucpAddressToMedusa, acpAddressToMedusa } from "../lib/address-translator"

describe("ucpAddressToMedusa — country normalization", () => {
  it("normalizes alpha-3 country to alpha-2", () => {
    const result = ucpAddressToMedusa({
      first_name: "Mario",
      last_name: "Rossi",
      street_address: "Via Roma 1",
      address_locality: "Rome",
      address_country: "ITA",
      postal_code: "00100",
    })
    expect(result.country_code).toBe("it")
  })

  it("normalizes alpha-2 to lowercase", () => {
    const result = ucpAddressToMedusa({
      street_address: "x",
      address_locality: "x",
      address_country: "IT",
      postal_code: "x",
    })
    expect(result.country_code).toBe("it")
  })

  it("normalizes country name", () => {
    const result = ucpAddressToMedusa({
      street_address: "x",
      address_locality: "x",
      address_country: "Italy",
      postal_code: "x",
    })
    expect(result.country_code).toBe("it")
  })

  it("returns undefined country for unknown input", () => {
    const result = ucpAddressToMedusa({
      street_address: "x",
      address_locality: "x",
      address_country: "Atlantis",
      postal_code: "x",
    })
    expect(result.country_code).toBeUndefined()
  })

  it("maps postal_address fields to Medusa fields", () => {
    const result = ucpAddressToMedusa({
      first_name: "Mario",
      last_name: "Rossi",
      street_address: "Via Roma 1",
      extended_address: "Apt 2",
      address_locality: "Rome",
      address_region: "RM",
      address_country: "IT",
      postal_code: "00100",
      phone_number: "+39123456789",
    })
    expect(result).toEqual({
      first_name: "Mario",
      last_name: "Rossi",
      address_1: "Via Roma 1",
      address_2: "Apt 2",
      city: "Rome",
      province: "RM",
      country_code: "it",
      postal_code: "00100",
      phone: "+39123456789",
    })
  })
})

describe("acpAddressToMedusa — country normalization", () => {
  it("normalizes alpha-3 country", () => {
    const result = acpAddressToMedusa({
      name: "Mario Rossi",
      line_one: "Via Roma 1",
      city: "Rome",
      state: "RM",
      country: "ITA",
      postal_code: "00100",
    })
    expect(result.country_code).toBe("it")
  })

  it("splits name into first_name/last_name", () => {
    const result = acpAddressToMedusa({
      name: "Mario Rossi",
      line_one: "x",
      city: "x",
      state: "x",
      country: "IT",
      postal_code: "x",
    })
    expect(result.first_name).toBe("Mario")
    expect(result.last_name).toBe("Rossi")
  })

  it("handles single-word name", () => {
    const result = acpAddressToMedusa({
      name: "Mario",
      line_one: "x",
      city: "x",
      state: "x",
      country: "IT",
      postal_code: "x",
    })
    expect(result.first_name).toBe("Mario")
    expect(result.last_name).toBeUndefined()
  })
})
