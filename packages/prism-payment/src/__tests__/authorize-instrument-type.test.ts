import { describe, it, expect, vi, beforeEach } from "vitest"
import PrismPaymentProviderService from "../modules/prism-payment/service"
import { isX402Instrument } from "../modules/prism-payment/types"

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

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64")

describe("isX402Instrument", () => {
  it("accepts x402 and the original-era instrument types with an x402 or untyped credential", () => {
    expect(isX402Instrument("x402", { type: "x402" })).toBe(true)
    expect(isX402Instrument("tokenized", { type: "x402" })).toBe(true)
    expect(isX402Instrument("default", {})).toBe(true)
    expect(isX402Instrument(undefined, {})).toBe(true)
    expect(isX402Instrument("x402", {})).toBe(true)
  })

  it("rejects other instrument types, other credential types and a missing credential", () => {
    expect(isX402Instrument("card", { type: "x402" })).toBe(false)
    expect(isX402Instrument("x402", { type: "tokenized" })).toBe(false)
    expect(isX402Instrument("x402", null)).toBe(false)
  })
})

describe("PrismPaymentProviderService.authorizePayment instrument type", () => {
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

  it("settles an x402 instrument", async () => {
    const result = await provider.authorizePayment({
      data: { eip3009_authorization: encode(credential), instrument_type: "x402" },
    } as any)
    expect(result.status).toBe("authorized")
    expect(settle).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["instrument type card", "card", credential],
    ["credential type tokenized", "x402", { ...credential, type: "tokenized" }],
  ])("rejects %s before settling", async (_label, instrumentType, cred) => {
    const result = await provider.authorizePayment({
      data: { eip3009_authorization: encode(cred), instrument_type: instrumentType },
    } as any)
    expect(result.status).toBe("error")
    expect((result.data as Record<string, unknown>).error).toBe("invalid_instrument_type")
    expect(settle).not.toHaveBeenCalled()
  })

  it("carries the instrument type from the payment session", async () => {
    const session = await provider.initiatePayment({
      amount: 15,
      currency_code: "usd",
      data: { eip3009_authorization: "x", instrument_type: "x402" },
    } as any)
    expect(session.data).toMatchObject({ instrument_type: "x402" })
  })
})
