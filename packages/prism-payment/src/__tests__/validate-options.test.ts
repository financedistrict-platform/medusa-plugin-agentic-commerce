import { afterEach, describe, expect, it, vi } from "vitest"
import PrismPaymentProviderService from "../modules/prism-payment/service"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"
import { PrismClient, resolvePrismApiKey } from "../lib/prism-client"

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

  it.each([
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
  ])("refuses to start when the API key is only %s", (_label, blank) => {
    vi.stubEnv("PRISM_API_KEY", "")

    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test", api_key: blank })).toThrow(/PRISM_API_KEY/)
  })

  it("refuses to start when the environment key is only whitespace", () => {
    vi.stubEnv("PRISM_API_KEY", "  \n")

    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test" })).toThrow(/PRISM_API_KEY/)
  })

  it("starts with an API key in the options", () => {
    vi.stubEnv("PRISM_API_KEY", "")

    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test", api_key: "key" })).not.toThrow()
  })

  it("starts with an API key only in the environment", () => {
    vi.stubEnv("PRISM_API_KEY", "key")

    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test" })).not.toThrow()
  })

  it("falls back to the environment key when the configured key is blank", () => {
    vi.stubEnv("PRISM_API_KEY", "env-key")

    expect(resolvePrismApiKey("   ")).toBe("env-key")
    expect(() => PrismPaymentProviderService.validateOptions({ api_url: "https://gw.test", api_key: "   " })).not.toThrow()
  })

  it("still requires the gateway URL", () => {
    vi.stubEnv("PRISM_API_KEY", "key")

    expect(() => PrismPaymentProviderService.validateOptions({ api_key: "key" })).toThrow(/api_url/)
  })
})

describe("Prism handler module options", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    ["no key", {}],
    ["an empty key", { api_key: "" }],
    ["a blank key", { api_key: "  " }],
  ])("refuses to start with %s and none in the environment", (_label, options) => {
    vi.stubEnv("PRISM_API_KEY", "")

    expect(() => new PrismPaymentHandlerAdapter({}, { api_url: "https://gw.test", ...options })).toThrow(/PRISM_API_KEY/)
  })

  it("starts with an API key in the options", () => {
    vi.stubEnv("PRISM_API_KEY", "")

    expect(() => new PrismPaymentHandlerAdapter({}, { api_url: "https://gw.test", api_key: "key" })).not.toThrow()
  })

  it("starts with an API key only in the environment", () => {
    vi.stubEnv("PRISM_API_KEY", "key")

    expect(() => new PrismPaymentHandlerAdapter({}, { api_url: "https://gw.test" })).not.toThrow()
  })
})

describe("Prism client API key", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses the key without the whitespace around it", () => {
    vi.stubEnv("PRISM_API_KEY", "")

    expect(new PrismClient({ apiKey: "  key\n" }).getApiKey()).toBe("key")
  })

  it("trims a key that comes from the environment", () => {
    vi.stubEnv("PRISM_API_KEY", "env-key\n")

    expect(new PrismClient().getApiKey()).toBe("env-key")
  })

  it("has no key when the configured and the environment keys are blank", () => {
    vi.stubEnv("PRISM_API_KEY", " ")

    expect(new PrismClient({ apiKey: "\t" }).getApiKey()).toBe("")
  })
})
