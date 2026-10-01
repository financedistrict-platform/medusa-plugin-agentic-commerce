import { describe, it, expect } from "vitest"
import AgenticCommerceService from "../modules/agentic-commerce/service"
import {
  createUcpVersionRegistry,
  DEFAULT_CURRENT_UCP_VERSION,
  DEFAULT_SUPPORTED_UCP_VERSIONS,
  KNOWN_UCP_VERSIONS,
} from "../lib/ucp-version-registry"

describe("createUcpVersionRegistry", () => {
  it("defaults to 2026-04-08 with 2026-08-25 and 2026-01-23 supported, lenient", () => {
    const registry = createUcpVersionRegistry()
    expect(DEFAULT_CURRENT_UCP_VERSION).toBe("2026-04-08")
    expect(DEFAULT_SUPPORTED_UCP_VERSIONS).toEqual(["2026-08-25", "2026-01-23"])
    expect(registry.current).toBe("2026-04-08")
    expect(registry.enabled()).toEqual(["2026-04-08", "2026-08-25", "2026-01-23"])
    expect(registry.negotiation).toBe("lenient")
    expect([...KNOWN_UCP_VERSIONS].sort()).toEqual(["2026-01-23", "2026-04-08", "2026-08-25"])
  })

  it("removes the current version from the supported list", () => {
    const registry = createUcpVersionRegistry({ ucp_version: "2026-08-25", ucp_supported_versions: ["2026-08-25", "2026-04-08"] })
    expect(registry.supported).toEqual(["2026-04-08"])
    expect(registry.enabled()).toEqual(["2026-08-25", "2026-04-08"])
  })

  it("serves only the current version with an empty supported list", () => {
    const registry = createUcpVersionRegistry({ ucp_supported_versions: [] })
    expect(registry.enabled()).toEqual(["2026-04-08"])
    expect(registry.isEnabled("2026-08-25")).toBe(false)
    expect(registry.isKnown("2026-08-25")).toBe(true)
  })

  it.each([
    [{ ucp_version: "2026-01-11" }, "Unknown UCP version: 2026-01-11"],
    [{ ucp_supported_versions: ["2026-08-25", "2027-01-01"] }, "Unknown supported UCP version: 2027-01-01"],
    [{ ucp_version_negotiation: "loose" }, "Unknown UCP version negotiation: loose"],
  ])("throws on %o", (options, message) => {
    expect(() => createUcpVersionRegistry(options)).toThrow(message)
  })
})

describe("AgenticCommerceService configuration", () => {
  it("keeps the ucp_version option and builds the registry from it", () => {
    const service = new AgenticCommerceService({}, { ucp_version: "2026-08-25" })
    expect(service.getUcpVersion()).toBe("2026-08-25")
    expect(service.getUcpRegistry().enabled()).toEqual(["2026-08-25", "2026-01-23"])
  })

  it("fails at boot on an unknown version", () => {
    expect(() => new AgenticCommerceService({}, { ucp_version: "2025-12-31" })).toThrow("Unknown UCP version: 2025-12-31")
  })

  it("fails at boot on an unknown negotiation mode", () => {
    expect(() => new AgenticCommerceService({}, { ucp_version_negotiation: "loose" as any })).toThrow("Unknown UCP version negotiation: loose")
  })
})
