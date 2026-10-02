import { describe, it, expect, vi, beforeEach } from "vitest"
import PrismPaymentProviderService from "../modules/prism-payment/service"

const credential = {
  type: "x402",
  x402Version: 2,
  paymentPayload: {
    x402Version: 2,
    scheme: "exact",
    network: "base",
    payload: {
      signature: "0xsig",
      authorization: {
        from: "0xAgent",
        to: "0xMerchant",
        value: "1500000",
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: "0xnonce",
      },
    },
  },
  paymentRequirements: { scheme: "exact" },
}

const { type: _type, ...untypedCredential } = credential

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64")

describe("PrismPaymentProviderService original-era instruments", () => {
  let provider: PrismPaymentProviderService
  let settle: ReturnType<typeof vi.fn>

  beforeEach(() => {
    provider = new PrismPaymentProviderService({}, {
      api_url: "https://gw.test",
      api_key: "key",
      verify_before_settle: false,
    } as any)
    settle = vi.fn().mockResolvedValue({ success: true, transaction: "0xtx", network: "base" })
    ;(provider as any).settleWithPrism = settle
  })

  const authorize = (data: Record<string, unknown>) =>
    provider.authorizePayment({ data: { ucp_version: "2026-01-23", ...data } } as any)

  it.each([
    ["instrument type tokenized", { instrument_type: "tokenized" }, credential],
    ["instrument type default", { instrument_type: "default" }, credential],
    ["an absent instrument type", {}, credential],
    ["a credential without type", { instrument_type: "x402" }, untypedCredential],
    ["tokenized with a credential without type", { instrument_type: "tokenized" }, untypedCredential],
  ])("settles %s", async (_label, extra, cred) => {
    const result = await authorize({ eip3009_authorization: encode(cred), ...extra })
    expect((result.data as Record<string, unknown>).error).not.toBe("invalid_instrument_type")
    expect(result.status).toBe("authorized")
    expect(settle).toHaveBeenCalledTimes(1)
  })

  it("still rejects instrument type card before settling", async () => {
    const result = await authorize({ eip3009_authorization: encode(credential), instrument_type: "card" })
    expect(result.status).toBe("error")
    expect((result.data as Record<string, unknown>).error).toBe("invalid_instrument_type")
    expect(settle).not.toHaveBeenCalled()
  })
})
