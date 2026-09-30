import { describe, it, expect } from "vitest"
import { buildUcpProfile } from "../lib/ucp-profile"
import { UCP_VERSION } from "../lib/ucp-version"

const handlers = {
  "xyz.fd.prism_payment": [{
    id: "xyz.fd.prism_payment",
    version: "2026-10-07",
    spec: "https://gw.test/ucp/prism.md",
    schema: "https://gw.test/ucp/schema.json",
    available_instruments: [{ type: "x402" }],
    config: {},
  }],
}

describe("buildUcpProfile", () => {
  const profile = buildUcpProfile(UCP_VERSION, "https://store.test", "Test Store", handlers)
  const entries = [
    ...Object.values(profile.ucp.services),
    ...Object.values(profile.ucp.capabilities),
  ].flat()

  it("uses 2026-08-25 for the profile and every dev.ucp entry", () => {
    expect(UCP_VERSION).toBe("2026-08-25")
    expect(profile.ucp.version).toBe(UCP_VERSION)
    for (const entry of entries) {
      expect(entry.version).toBe(UCP_VERSION)
    }
  })

  it("gives every entry a spec and schema under the protocol version", () => {
    for (const entry of entries) {
      expect(entry.spec.startsWith(`https://ucp.dev/${UCP_VERSION}/`)).toBe(true)
      expect(entry.schema.startsWith(`https://ucp.dev/${UCP_VERSION}/`)).toBe(true)
    }
  })

  it("points catalog capabilities at the split catalog schemas", () => {
    expect(profile.ucp.capabilities["dev.ucp.shopping.catalog.search"][0].schema)
      .toBe(`https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_search.json`)
    expect(profile.ucp.capabilities["dev.ucp.shopping.catalog.lookup"][0].schema)
      .toBe(`https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_lookup.json`)
  })

  it("passes the payment handlers through unchanged and emits no key set", () => {
    expect(profile.ucp.payment_handlers).toBe(handlers)
    expect(Object.keys(profile)).toEqual(["ucp", "name"])
    expect(profile.ucp.services["dev.ucp.shopping"][0].endpoint).toBe("https://store.test/ucp")
  })
})
