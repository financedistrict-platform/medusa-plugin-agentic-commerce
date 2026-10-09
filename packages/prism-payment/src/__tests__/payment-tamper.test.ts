import { describe, it, expect, vi, beforeEach } from "vitest"
import PrismPaymentProviderService from "../modules/prism-payment/service"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"
import {
  CART_TOTAL,
  NETWORK,
  QUOTE_SIGNING_KEY,
  checkoutData,
  credential,
  encode,
  quotedEntry,
  signedCheckoutData,
  unsignedCheckoutData,
} from "./helpers/quoted-payment"
import { quoteSignatureFor } from "../lib/quote-binding"

function makeProvider(options: Record<string, unknown> = {}) {
  const provider = new PrismPaymentProviderService({}, {
    api_url: "https://gw.test",
    api_key: "key",
    ...options,
  } as any)
  const client = {
    verifyPayment: vi.fn().mockResolvedValue({ isValid: true }),
    settlePayment: vi.fn().mockResolvedValue({ success: true, transaction: "0xtx", network: NETWORK }),
    getApiKey: () => QUOTE_SIGNING_KEY,
  }
  ;(provider as any).client = client
  return { provider, client }
}

async function sessionData(
  provider: PrismPaymentProviderService,
  cred: unknown,
  amount: number = CART_TOTAL,
  storedQuote: unknown = checkoutData,
  currencyCode = "usd",
) {
  const initiated = await provider.initiatePayment({
    amount,
    currency_code: currencyCode,
    data: { eip3009_authorization: encode(cred), x402_version: 2, prism_checkout_data: storedQuote },
  } as any)
  return initiated.data as Record<string, unknown>
}

describe("Prism provider tamper cases", () => {
  let provider: PrismPaymentProviderService
  let client: ReturnType<typeof makeProvider>["client"]

  beforeEach(() => {
    ;({ provider, client } = makeProvider())
  })

  const expectRejected = async (data: Record<string, unknown>, error: string) => {
    const result = await provider.authorizePayment({ data } as any)
    expect(result.status).toBe("error")
    expect((result.data as Record<string, unknown>).error).toBe(error)
    expect(client.verifyPayment).not.toHaveBeenCalled()
    expect(client.settlePayment).not.toHaveBeenCalled()
  }

  it("rejects a buyer-created session that carries no payment credential instead of approving it", async () => {
    const initiated = await provider.initiatePayment({
      amount: CART_TOTAL,
      currency_code: "usd",
      data: { prism_checkout_data: checkoutData },
    } as any)

    await expectRejected(initiated.data as Record<string, unknown>, "missing_payment_authorization")
  })

  it("refuses to capture a session that was never settled and holds no authorization", async () => {
    const initiated = await provider.initiatePayment({
      amount: CART_TOTAL,
      currency_code: "usd",
      data: { prism_checkout_data: checkoutData, prism_tx_id: "0xforged", captured: true, verified: true },
    } as any)

    await expect(provider.capturePayment({ data: initiated.data } as any)).rejects.toThrow("missing_payment_authorization")
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("reports a buyer-created session as pending even when it names a settlement", async () => {
    const initiated = await provider.initiatePayment({
      amount: CART_TOTAL,
      currency_code: "usd",
      data: { prism_tx_id: "0xforged", captured: true, verified: true, x402_authorization: "forged" },
    } as any)

    const status = await provider.getPaymentStatus({ data: initiated.data } as any)
    expect(status.status).toBe("pending")
  })

  it("rejects an authorization when the session carries no stored quote", async () => {
    await expectRejected({ eip3009_authorization: encode(credential()), amount: CART_TOTAL }, "missing_payment_quote")
  })

  it("rejects an authorization signed below the quoted amount", async () => {
    await expectRejected(await sessionData(provider, credential({ value: "1" })), "amount_mismatch")
  })

  it("rejects an authorization paying a recipient other than the quoted one", async () => {
    await expectRejected(
      await sessionData(provider, credential({ to: "0x3333333333333333333333333333333333333333" })),
      "wrong_recipient",
    )
  })

  it("rejects an authorization on a network that was never quoted", async () => {
    await expectRejected(await sessionData(provider, credential({ network: "eip155:1" })), "no_matching_quote_entry")
  })

  it("rejects an authorization for a token that was never quoted", async () => {
    await expectRejected(
      await sessionData(provider, credential({ asset: "0x4444444444444444444444444444444444444444" })),
      "no_matching_quote_entry",
    )
  })

  it("rejects an authorization without an expiry", async () => {
    await expectRejected(await sessionData(provider, credential({ validBefore: undefined })), "missing_eip3009_fields")
  })

  it("rejects an expired authorization", async () => {
    await expectRejected(await sessionData(provider, credential({ validBefore: "1" })), "authorization_expired")
  })

  it("rejects an authorization that is not valid yet", async () => {
    const later = String(Math.floor(Date.now() / 1000) + 600)
    await expectRejected(await sessionData(provider, credential({ validAfter: later })), "authorization_not_yet_valid")
  })

  it("rejects an authorization without a nonce", async () => {
    await expectRejected(await sessionData(provider, credential({ nonce: undefined })), "missing_eip3009_fields")
  })

  it("rejects an authorization with a malformed nonce", async () => {
    await expectRejected(await sessionData(provider, credential({ nonce: "0x01" })), "invalid_nonce")
  })

  it("rejects a quote prepared for a different total than the current order total", async () => {
    await expectRejected(await sessionData(provider, credential(), CART_TOTAL * 100), "quote_total_mismatch")
  })

  it("rejects a quote prepared in another currency than the order", async () => {
    await expectRejected(await sessionData(provider, credential(), CART_TOTAL, checkoutData, "jpy"), "quote_currency_mismatch")
  })

  it("rejects a quote signed without saying which currency it was prepared in", async () => {
    const { preparedCurrency: _dropped, ...withoutCurrency } = unsignedCheckoutData() as Record<string, unknown>
    const signed = { ...withoutCurrency, quoteSignature: quoteSignatureFor(withoutCurrency as never, QUOTE_SIGNING_KEY) }
    await expectRejected(await sessionData(provider, credential(), CART_TOTAL, signed), "missing_payment_quote")
  })

  it("rejects a stored quote whose currency was rewritten after it was signed", async () => {
    const forged = { ...checkoutData, preparedCurrency: "jpy" }
    await expectRejected(await sessionData(provider, credential(), CART_TOTAL, forged, "jpy"), "invalid_quote_signature")
  })

  it("rejects a stored quote whose amount was rewritten after it was signed", async () => {
    const forged = { ...unsignedCheckoutData([{ ...quotedEntry, amount: "1" }]), quoteSignature: checkoutData.quoteSignature }
    await expectRejected(await sessionData(provider, credential({ value: "1" }), CART_TOTAL, forged), "invalid_quote_signature")
  })

  it("rejects a quote signed with a different key", async () => {
    const foreign = signedCheckoutData("other-key", [{ ...quotedEntry, amount: "1" }])
    await expectRejected(await sessionData(provider, credential({ value: "1" }), CART_TOTAL, foreign), "invalid_quote_signature")
  })

  it("rejects an unsigned quote", async () => {
    const unsigned = unsignedCheckoutData([{ ...quotedEntry, amount: "1" }])
    await expectRejected(await sessionData(provider, credential({ value: "1" }), CART_TOTAL, unsigned), "missing_payment_quote")
  })

  it("rejects a quote placed directly into session data without a valid signature", async () => {
    const data = await sessionData(provider, credential({ value: "1" }))
    const quote = data.payment_quote as Record<string, unknown>
    await expectRejected(
      { ...data, payment_quote: { ...quote, accepts: [{ ...quotedEntry, amount: "1" }] } },
      "invalid_quote_signature",
    )
  })

  it("settles against the requirements rebuilt from the stored quote, not the buyer's", async () => {
    const result = await provider.authorizePayment({ data: await sessionData(provider, credential()) } as any)

    expect(result.status).toBe("authorized")
    expect(client.settlePayment).toHaveBeenCalledTimes(1)
    const request = client.settlePayment.mock.calls[0][0]
    expect(request.x402Version).toBe(2)
    expect(request.paymentRequirements).toEqual(quotedEntry)
    expect(client.verifyPayment.mock.calls[0][0].paymentRequirements).toEqual(quotedEntry)
  })

  it("captures against the requirements rebuilt from the stored quote when auto-capture is off", async () => {
    ;({ provider, client } = makeProvider({ auto_capture: false }))
    const authorized = await provider.authorizePayment({ data: await sessionData(provider, credential()) } as any)
    expect(authorized.status).toBe("authorized")
    expect(client.settlePayment).not.toHaveBeenCalled()

    await provider.capturePayment({ data: authorized.data } as any)

    expect(client.settlePayment).toHaveBeenCalledTimes(1)
    expect(client.settlePayment.mock.calls[0][0].paymentRequirements).toEqual(quotedEntry)
  })

  it("refuses to capture a stored authorization when the session carries no quote", async () => {
    ;({ provider, client } = makeProvider({ auto_capture: false }))

    await expect(
      provider.capturePayment({ data: { x402_authorization: encode(credential()), amount: CART_TOTAL } } as any),
    ).rejects.toThrow("missing_payment_quote")
    expect(client.settlePayment).not.toHaveBeenCalled()
  })
})

describe("Prism quote produced by the handler", () => {
  const preparedConfig = { x402Version: 2, resource: { url: "https://shop.test/ucp/checkout-sessions/cart_1" }, accepts: [quotedEntry] }
  const discovery = {
    "xyz.fd.prism_payment": [{
      id: "xyz.fd.prism_payment",
      version: "2026-04-08",
      spec: "https://gw.test/ucp/prism.md",
      schema: "https://gw.test/ucp/schema.json",
      config: {},
    }],
  }

  function handlerWith(preparePayment: ReturnType<typeof vi.fn>) {
    const adapter = new PrismPaymentHandlerAdapter({}, { api_url: "https://gw.test", api_key: QUOTE_SIGNING_KEY })
    ;(adapter as any).client = {
      getApiUrl: () => "https://gw.test",
      getApiKey: () => QUOTE_SIGNING_KEY,
      fetchUcpHandlers: vi.fn().mockResolvedValue(discovery),
      fetchAcpHandlers: vi.fn().mockResolvedValue([]),
      preparePayment,
    }
    return adapter
  }

  const prepare = (adapter: PrismPaymentHandlerAdapter, metadata: Record<string, unknown> = {}, stored?: unknown) =>
    adapter.prepareCheckoutPayment({
      cart: { id: "cart_1", total: CART_TOTAL, currency_code: "usd", metadata },
      stored,
      checkoutBaseUrl: "https://shop.test/ucp/checkout-sessions",
      storeName: "Shop",
      ucpVersion: "2026-04-08",
      container: { resolve: () => ({ updateCarts: vi.fn() }) },
    } as any)

  it("is accepted by the provider end to end", async () => {
    const prepared = await prepare(handlerWith(vi.fn().mockResolvedValue(preparedConfig)))
    const { provider, client } = makeProvider()

    const result = await provider.authorizePayment({
      data: await sessionData(provider, credential(), CART_TOTAL, JSON.parse(JSON.stringify(prepared))),
    } as any)

    expect(result.status).toBe("authorized")
    expect(client.settlePayment.mock.calls[0][0].paymentRequirements).toEqual(quotedEntry)
  })

  it("re-prepares instead of reusing a stored quote that is not signed", async () => {
    const preparePayment = vi.fn().mockResolvedValue(preparedConfig)
    const forged = unsignedCheckoutData([{ ...quotedEntry, amount: "1" }])

    const prepared = await prepare(handlerWith(preparePayment), {}, forged)

    expect(preparePayment).toHaveBeenCalledTimes(1)
    expect(prepared?.ucp?.["xyz.fd.prism_payment"][0].config.accepts[0].amount).toBe(quotedEntry.amount)
    expect(prepared?.quoteSignature).toBe(checkoutData.quoteSignature)
  })

  it("reuses the quote the server stored for the cart without asking Prism again", async () => {
    const preparePayment = vi.fn().mockResolvedValue(preparedConfig)

    const prepared = await prepare(handlerWith(preparePayment), {}, checkoutData)

    expect(preparePayment).not.toHaveBeenCalled()
    expect(prepared).toEqual(checkoutData)
  })

  it("ignores a signed quote found in cart metadata and prepares a fresh one", async () => {
    const preparePayment = vi.fn().mockResolvedValue(preparedConfig)

    await prepare(handlerWith(preparePayment), { prism_checkout_data: checkoutData })

    expect(preparePayment).toHaveBeenCalledTimes(1)
  })

  it("never writes the quote into buyer-writable cart metadata", async () => {
    const updateCarts = vi.fn()
    const adapter = handlerWith(vi.fn().mockResolvedValue(preparedConfig))

    await adapter.prepareCheckoutPayment({
      cart: { id: "cart_1", total: CART_TOTAL, currency_code: "usd", metadata: {} },
      checkoutBaseUrl: "https://shop.test/ucp/checkout-sessions",
      storeName: "Shop",
      ucpVersion: "2026-04-08",
      container: { resolve: () => ({ updateCarts }) },
    } as any)

    expect(updateCarts).not.toHaveBeenCalled()
  })

  it("reads the handlers it advertises from the stored quote, not from cart metadata", () => {
    const adapter = handlerWith(vi.fn())

    expect(adapter.getUcpCheckoutHandlers(checkoutData)).toEqual(checkoutData.ucp)
    expect(adapter.getAcpCheckoutHandlers(undefined)).toEqual([])
    expect(adapter.getUcpCheckoutHandlers({ prism_checkout_data: checkoutData } as any)).toEqual({})
  })
})
