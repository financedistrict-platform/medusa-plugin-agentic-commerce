import { describe, it, expect, vi, beforeEach } from "vitest"
import PrismPaymentProviderService from "../modules/prism-payment/service"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"
import {
  ASSET,
  CART_TOTAL,
  NETWORK,
  QUOTED_VALUE,
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

  it("rejects an authorization that carries no signature", async () => {
    const cred = credential()
    delete (cred.paymentPayload as Record<string, any>).payload.signature
    await expectRejected(await sessionData(provider, cred), "missing_eip3009_fields")
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

  it("rejects declared requirements that name a different amount than the quote", async () => {
    await expectRejected(
      await sessionData(provider, credential({ declared: { amount: "1" } })),
      "accepted_requirements_mismatch",
    )
  })

  it("rejects declared requirements that name a different recipient than the quote", async () => {
    await expectRejected(
      await sessionData(provider, credential({ declared: { payTo: "0x3333333333333333333333333333333333333333" } })),
      "accepted_requirements_mismatch",
    )
  })

  it("rejects declared requirements that name a different scheme than the quote", async () => {
    await expectRejected(
      await sessionData(provider, credential({ declared: { scheme: "upto" } })),
      "accepted_requirements_mismatch",
    )
  })

  it("rejects a credential that declares no requirements even when the buyer names the quoted network and token elsewhere", async () => {
    await expectRejected(
      await sessionData(provider, credential({ omitAccepted: true, legacyNetwork: NETWORK })),
      "no_matching_quote_entry",
    )
  })

  it("forwards the quoted requirements as the declared requirements", async () => {
    const result = await provider.authorizePayment({
      data: await sessionData(provider, credential({ declared: { extra: { name: "Worthless", version: "9" }, maxTimeoutSeconds: 1 } })),
    } as any)

    expect(result.status).toBe("authorized")
    expect(client.settlePayment.mock.calls[0][0].paymentPayload.accepted).toEqual(quotedEntry)
    expect(client.verifyPayment.mock.calls[0][0].paymentPayload.accepted).toEqual(quotedEntry)
  })

  it("forwards only the signed fields of the payload and nothing else the buyer attached", async () => {
    const cred = credential()
    const payload = cred.paymentPayload as Record<string, any>
    payload.extensions = { gasSponsoring: { info: "buyer" } }
    payload.resource = { url: "https://elsewhere.test" }
    payload.payload.extra = "buyer"
    payload.payload.authorization.extra = "buyer"

    const result = await provider.authorizePayment({ data: await sessionData(provider, cred) } as any)

    expect(result.status).toBe("authorized")
    const forwarded = client.settlePayment.mock.calls[0][0].paymentPayload
    expect(forwarded).toEqual({
      x402Version: 2,
      accepted: quotedEntry,
      payload: { signature: "0xsig", authorization: expect.not.objectContaining({ extra: expect.anything() }) },
    })
    expect(Object.keys(forwarded.payload.authorization).sort()).toEqual(["from", "nonce", "to", "validAfter", "validBefore", "value"])
  })

  it("does not forward a network the buyer put on the payload next to the declared requirements", async () => {
    const result = await provider.authorizePayment({
      data: await sessionData(provider, credential({ legacyNetwork: "eip155:1" })),
    } as any)

    expect(result.status).toBe("authorized")
    expect(client.settlePayment.mock.calls[0][0].paymentPayload).not.toHaveProperty("network")
  })

  it("checks the configured chains against the quoted network", async () => {
    ;({ provider, client } = makeProvider({ supported_chains: ["base"] }))
    await expectRejected(await sessionData(provider, credential()), "unsupported_chain")
  })

  it.each([["base-sepolia"], ["eip155:84532"], ["Base-Sepolia"]])("accepts the quoted network when the configured chains list %s", async (chain) => {
    ;({ provider, client } = makeProvider({ supported_chains: [chain] }))

    const result = await provider.authorizePayment({ data: await sessionData(provider, credential()) } as any)

    expect(result.status).toBe("authorized")
  })

  it("rejects capture of a stored authorization when the configured chains no longer include the quoted network", async () => {
    ;({ provider, client } = makeProvider({ auto_capture: false }))
    const authorized = await provider.authorizePayment({ data: await sessionData(provider, credential()) } as any)
    ;({ provider, client } = makeProvider({ auto_capture: false, supported_chains: ["base"] }))

    await expect(provider.capturePayment({ data: authorized.data } as any)).rejects.toThrow("unsupported_chain")
    expect(client.settlePayment).not.toHaveBeenCalled()
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

describe("Prism settlement is reconciled with the quote", () => {
  let provider: PrismPaymentProviderService
  let client: ReturnType<typeof makeProvider>["client"]

  beforeEach(() => {
    ;({ provider, client } = makeProvider())
  })

  const authorize = async () =>
    provider.authorizePayment({ data: await sessionData(provider, credential()) } as any)

  it.each([
    ["an empty reply", {}],
    ["a reply without the success flag", { transaction: "0xtx", network: NETWORK }],
    ["a success flag that is not boolean true", { success: "true", transaction: "0xtx", network: NETWORK }],
    ["a success without a transaction hash", { success: true, network: NETWORK }],
    ["a success with a blank transaction hash", { success: true, transaction: "", network: NETWORK }],
    ["an explicit failure that still names a transaction", { success: false, transaction: "0xtx", network: NETWORK }],
  ])("does not authorize on %s", async (_label, reply) => {
    client.settlePayment.mockResolvedValue(reply)

    const result = await authorize()

    expect(result.status).toBe("error")
    expect((result.data as Record<string, unknown>).error).toMatch(/^settlement_failed/)
    expect(result.data).not.toHaveProperty("prism_tx_id")
  })

  it("keeps the transaction hash when a settled reply does not match the quote, without treating it as settled", async () => {
    client.settlePayment.mockResolvedValue({ success: true, transaction: "0xmoved", network: NETWORK, amount: "15.00" })

    const result = await authorize()

    expect(result.status).toBe("error")
    expect(result.data).toMatchObject({ unreconciled_transaction: "0xmoved" })
    expect(result.data).not.toHaveProperty("prism_tx_id")
    expect((await provider.getPaymentStatus({ data: result.data } as any)).status).toBe("error")
  })

  it("names the transaction when a manual capture settles something that does not match the quote", async () => {
    ;({ provider, client } = makeProvider({ auto_capture: false }))
    const authorized = await authorize()
    client.settlePayment.mockResolvedValue({ success: true, transaction: "0xmoved", network: "eip155:1" })

    await expect(provider.capturePayment({ data: authorized.data } as any)).rejects.toThrow("0xmoved")
  })

  it("does not report a session as captured only because it names a transaction", async () => {
    const data = { ...((await authorize()).data ?? {}) }

    expect((await provider.getPaymentStatus({ data } as any)).status).toBe("authorized")
    expect((await provider.getPaymentStatus({ data: { ...data, captured: true } } as any)).status).toBe("captured")
  })

  it("does not authorize when the settlement reports another network than the quoted one", async () => {
    client.settlePayment.mockResolvedValue({ success: true, transaction: "0xtx", network: "eip155:1" })

    const result = await authorize()

    expect(result.status).toBe("error")
    expect((result.data as Record<string, unknown>).error).toBe("settlement_failed: settled_network_mismatch")
    expect(result.data).not.toHaveProperty("prism_tx_id")
  })

  it.each([["1"], ["1499999"], [1500001]])("does not authorize when the settlement reports %s instead of the quoted amount", async (amount) => {
    client.settlePayment.mockResolvedValue({ success: true, transaction: "0xtx", network: NETWORK, amount })

    const result = await authorize()

    expect(result.status).toBe("error")
    expect((result.data as Record<string, unknown>).error).toBe("settlement_failed: settled_amount_mismatch")
    expect(result.data).not.toHaveProperty("prism_tx_id")
  })

  it("records the settled amount, token and network next to the transaction", async () => {
    client.settlePayment.mockResolvedValue({ success: true, transaction: "0xtx", network: NETWORK, amount: QUOTED_VALUE })

    const result = await authorize()

    expect(result.status).toBe("authorized")
    expect(result.data).toMatchObject({
      prism_tx_id: "0xtx",
      transaction_network: NETWORK,
      settled_amount: QUOTED_VALUE,
      settled_asset: ASSET,
    })
  })

  it("does not capture a manually settled payment on a reply without a transaction hash", async () => {
    ;({ provider, client } = makeProvider({ auto_capture: false }))
    const authorized = await authorize()
    client.settlePayment.mockResolvedValue({ success: true, network: NETWORK })

    await expect(provider.capturePayment({ data: authorized.data } as any)).rejects.toThrow("missing_transaction_hash")
  })

  it("records the settled amount when a manual capture settles", async () => {
    ;({ provider, client } = makeProvider({ auto_capture: false }))
    const authorized = await authorize()

    const captured = await provider.capturePayment({ data: authorized.data } as any)

    expect(captured.data).toMatchObject({ prism_tx_id: "0xtx", settled_amount: QUOTED_VALUE, settled_asset: ASSET, captured: true })
  })

  describe("right before the payment is marked captured", () => {
    const settled = async () => ((await authorize()).data ?? {}) as Record<string, unknown>

    it("captures a settlement that matches the quote and the order total", async () => {
      const data = await settled()

      const captured = await provider.capturePayment({ data } as any)

      expect(captured.data).toMatchObject({ captured: true, prism_tx_id: "0xtx" })
    })

    it("refuses to capture when the order total moved after the settlement", async () => {
      const data = await settled()

      await expect(provider.capturePayment({ data: { ...data, amount: CART_TOTAL * 100 } } as any)).rejects.toThrow("quote_total_mismatch")
    })

    it("refuses to capture when the settled amount is below the quoted amount", async () => {
      const data = await settled()

      await expect(provider.capturePayment({ data: { ...data, settled_amount: "1" } } as any)).rejects.toThrow("settled_amount_mismatch")
    })

    it("refuses to capture a settlement that recorded no settled amount", async () => {
      const { settled_amount: _dropped, ...data } = await settled()

      await expect(provider.capturePayment({ data } as any)).rejects.toThrow("settled_amount_mismatch")
    })

    it("refuses to capture a settlement on a token or network that was never quoted", async () => {
      const data = await settled()

      await expect(
        provider.capturePayment({ data: { ...data, settled_asset: "0x4444444444444444444444444444444444444444" } } as any),
      ).rejects.toThrow("settled_payment_not_quoted")
      await expect(
        provider.capturePayment({ data: { ...data, transaction_network: "eip155:1" } } as any),
      ).rejects.toThrow("settled_payment_not_quoted")
    })

    it("refuses to capture when the stored quote is missing or was rewritten", async () => {
      const data = await settled()
      const quote = data.payment_quote as Record<string, unknown>

      await expect(provider.capturePayment({ data: { ...data, payment_quote: undefined } } as any)).rejects.toThrow("missing_payment_quote")
      await expect(
        provider.capturePayment({ data: { ...data, payment_quote: { ...quote, preparedAmount: "1" } } } as any),
      ).rejects.toThrow("invalid_quote_signature")
    })
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

describe("Prism provider settles a session only once", () => {
  let provider: PrismPaymentProviderService
  let client: ReturnType<typeof makeProvider>["client"]

  beforeEach(() => {
    ;({ provider, client } = makeProvider())
  })

  const settledSession = async () => {
    const result = await provider.authorizePayment({ data: await sessionData(provider, credential()) } as any)
    expect(result.status).toBe("authorized")
    expect(client.settlePayment).toHaveBeenCalledTimes(1)
    return result.data as Record<string, unknown>
  }

  it("authorizes a session that already holds its settlement without verifying or settling again", async () => {
    const data = await settledSession()
    client.verifyPayment.mockClear()
    client.settlePayment.mockClear()

    const again = await provider.authorizePayment({ data } as any)

    expect(again.status).toBe("authorized")
    expect(again.data).toEqual(data)
    expect(client.verifyPayment).not.toHaveBeenCalled()
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it.each([
    ["the settled amount no longer matches the quote", (data: Record<string, unknown>) => ({ ...data, settled_amount: "1" }), "settled_amount_mismatch"],
    ["the settled token was never quoted", (data: Record<string, unknown>) => ({ ...data, settled_asset: "0x4444444444444444444444444444444444444444" }), "settled_payment_not_quoted"],
    ["the stored quote was rewritten", (data: Record<string, unknown>) => ({ ...data, payment_quote: { ...(data.payment_quote as object), preparedAmount: "1" } }), "invalid_quote_signature"],
    ["the stored quote is gone", (data: Record<string, unknown>) => ({ ...data, payment_quote: undefined }), "missing_payment_quote"],
    ["the order total moved", (data: Record<string, unknown>) => ({ ...data, amount: CART_TOTAL * 100 }), "quote_total_mismatch"],
  ])("refuses to authorize a settled session when %s, and never settles again", async (_label, tamper, error) => {
    const data = await settledSession()
    client.verifyPayment.mockClear()
    client.settlePayment.mockClear()

    const again = await provider.authorizePayment({ data: tamper(data) } as any)

    expect(again.status).toBe("error")
    expect((again.data as Record<string, unknown>).error).toBe(error)
    expect(client.verifyPayment).not.toHaveBeenCalled()
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("refuses a settlement reference that is not a transaction hash string", async () => {
    const data = await settledSession()
    client.settlePayment.mockClear()

    const again = await provider.authorizePayment({ data: { ...data, prism_tx_id: { forged: true } } } as any)

    expect(again.status).toBe("error")
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("does not copy a settlement, a captured flag or a quote from the data of a session update", async () => {
    const data = await sessionData(provider, credential())

    const updated = await provider.updatePayment({
      amount: CART_TOTAL,
      currency_code: "usd",
      data: {
        ...data,
        prism_tx_id: "0xforged",
        transaction_reference: "0xforged",
        transaction_network: NETWORK,
        settled_amount: QUOTED_VALUE,
        settled_asset: ASSET,
        captured: true,
        payment_quote: { forged: true },
      },
    } as any)

    const kept = updated.data as Record<string, unknown>
    for (const key of ["prism_tx_id", "transaction_reference", "transaction_network", "settled_amount", "settled_asset", "captured", "payment_quote"]) {
      expect(kept).not.toHaveProperty(key)
    }
    expect(kept).toMatchObject({ prism_session_id: data.prism_session_id, amount: CART_TOTAL, currency_code: "usd" })
    expect(kept.eip3009_authorization).toBe(data.eip3009_authorization)

    const result = await provider.authorizePayment({ data: kept } as any)
    expect(result.status).toBe("error")
    expect((result.data as Record<string, unknown>).error).toBe("missing_payment_quote")
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("keeps the signed quote of a session update that carries the checkout data again", async () => {
    const data = await sessionData(provider, credential())

    const updated = await provider.updatePayment({
      amount: CART_TOTAL,
      currency_code: "usd",
      data: { eip3009_authorization: data.eip3009_authorization, prism_checkout_data: checkoutData },
    } as any)

    expect((updated.data as Record<string, unknown>).payment_quote).toEqual(data.payment_quote)
  })
})
