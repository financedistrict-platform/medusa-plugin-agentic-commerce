import { afterEach, describe, expect, it, vi } from "vitest"
import PrismPaymentProviderService from "../modules/prism-payment/service"

describe("Prism provider options", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("refuses to start without an API key in the options or the environment", () => {
    vi.stubEnv("PRISM_API_KEY", "")

    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test" })).toThrow(/api_key|PRISM_API_KEY/)
  })

  it("refuses to start when the configured API key is empty and the environment has none", () => {
    vi.stubEnv("PRISM_API_KEY", "")

    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test", api_key: "" })).toThrow(/PRISM_API_KEY/)
  })

  it("starts with an API key in the options", () => {
    vi.stubEnv("PRISM_API_KEY", "")

    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test", api_key: "key" })).not.toThrow()
  })

  it("starts with an API key only in the environment", () => {
    vi.stubEnv("PRISM_API_KEY", "key")

    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test" })).not.toThrow()
  })

  it("still requires the gateway URL", () => {
    vi.stubEnv("PRISM_API_KEY", "key")

    expect(() => PrismPaymentProviderService.validateOptions({ api_key: "key" })).toThrow(/api_url/)
  })
})
