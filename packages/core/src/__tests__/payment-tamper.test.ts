import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"
import { fakeAgentSessions } from "./helpers/agent-session-store"
import { extractSignedSummary } from "../lib/validate-signed-amount"
import { paymentSessionDataFor } from "../workflows/steps/setup-payment"

const completeRun = vi.hoisted(() => vi.fn(async () => {
  throw new Error("stop after settlement handoff")
}))

vi.mock("../workflows/complete-checkout-session", () => ({
  default: () => ({ run: completeRun }),
}))

const paymentFlows = vi.hoisted(() => ({
  createCollection: vi.fn(async () => ({})),
  createSessions: vi.fn(async () => ({})),
  deleteSessions: vi.fn(async () => ({})),
}))

vi.mock("@medusajs/medusa/core-flows", () => ({
  createPaymentCollectionForCartWorkflow: () => ({ run: paymentFlows.createCollection }),
  createPaymentSessionsWorkflow: () => ({ run: paymentFlows.createSessions }),
  deletePaymentSessionsWorkflow: () => ({ run: paymentFlows.deleteSessions }),
}))

vi.mock("@medusajs/framework/workflows-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@medusajs/framework/workflows-sdk")>()),
  createStep: (_name: string, invoke: unknown) => invoke,
}))

import { POST as ucpComplete } from "../api/ucp/checkout-sessions/[id]/complete/route"
import { POST as acpComplete } from "../api/acp/checkout_sessions/[id]/complete/route"
import { setupPaymentStep } from "../workflows/steps/setup-payment"
import { paymentToCapture } from "../lib/payment-to-capture"
import AgenticCommerceService from "../modules/agentic-commerce/service"

const HANDLER_ID = "xyz.fd.prism_payment"
const QUOTED_AMOUNT = "1500000"
const QUOTED_TOTAL = 15

const storedQuote = {
  preparedAmount: String(QUOTED_TOTAL),
  preparedCurrency: "usd",
  acp: {
    id: HANDLER_ID,
    config: {
      x402Version: 2,
      accepts: [{ network: "eip155:84532", asset: "0xasset", amount: QUOTED_AMOUNT, payTo: "0xmerchant" }],
    },
  },
  ucp: {
    [HANDLER_ID]: [{
      id: HANDLER_ID,
      config: {
        x402Version: 2,
        accepts: [{ network: "eip155:84532", asset: "0xasset", amount: QUOTED_AMOUNT, payTo: "0xmerchant" }],
      },
    }],
  },
}

function sessionsHolding(quote: unknown) {
  return fakeAgentSessions([{ cart_id: "cart_1", handler_data: quote === undefined ? {} : { [HANDLER_ID]: quote } }])
}

function containerFor(services: Record<string, unknown>, quote: unknown) {
  const all: Record<string, unknown> = { agenticCommerceSession: sessionsHolding(quote), ...services }
  return { resolve: (name: string) => all[name] }
}

function signedPayload(value: string) {
  return {
    accepted: { network: "eip155:84532", asset: "0xAsset", amount: QUOTED_AMOUNT, payTo: "0xMerchant" },
    payload: {
      signature: "0xsig",
      authorization: { from: "0xBuyer", to: "0xMerchant", value, validAfter: "0", validBefore: "9999999999", nonce: "0x01" },
    },
  }
}

function base64Credential(value: string) {
  return Buffer.from(JSON.stringify({ x402Version: 2, paymentPayload: signedPayload(value) })).toString("base64")
}

function setup(
  credential: Record<string, unknown>,
  options: { quote?: unknown; providerId?: string } = {},
) {
  const quote = "quote" in options ? options.quote : storedQuote
  const providerId = options.providerId ?? "pp_prism_prism"
  const { service } = createStoreService({ version: "2026-04-08" })
  ;(service as any).getPaymentProviderId = () => providerId
  const cart = { id: "cart_1", items: [], metadata: {} }
  const query = { graph: vi.fn(async () => ({ data: [cart] })) }
  completeRun.mockClear()
  const req = {
    ...createRequest({ agenticCommerce: service, query, agenticCommerceSession: sessionsHolding(quote) }, { id: "cart_1" }),
    body: { payment: { instruments: [{ id: "i1", handler_id: HANDLER_ID, type: "x402", credential }] } },
  }
  return { req: req as any, res: createResponse() as any }
}

function settledAuthorization() {
  const input = (completeRun.mock.calls[0] as unknown as [{ input: { payment_data: { eip3009_authorization: string } } }])[0]
  return input.input.payment_data.eip3009_authorization
}

function settledSummary() {
  return extractSignedSummary(settledAuthorization())
}

describe("UCP complete tamper cases", () => {
  beforeEach(() => {
    completeRun.mockClear()
  })

  it("rejects a credential carrying both authorization and paymentPayload with different amounts", async () => {
    const { req, res } = setup({
      type: "x402",
      x402Version: 2,
      paymentPayload: signedPayload(QUOTED_AMOUNT),
      authorization: base64Credential("1"),
    })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects a credential carrying both authorization and paymentPayload even when amounts agree", async () => {
    const { req, res } = setup({
      type: "x402",
      x402Version: 2,
      paymentPayload: signedPayload(QUOTED_AMOUNT),
      authorization: base64Credential(QUOTED_AMOUNT),
    })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects an authorization-only credential signed below the quote", async () => {
    const { req, res } = setup({ type: "x402", authorization: base64Credential("1") })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects an authorization that wraps another base64 authorization", async () => {
    const nested = Buffer.from(JSON.stringify({ authorization: base64Credential(QUOTED_AMOUNT) })).toString("base64")
    const { req, res } = setup({ type: "x402", authorization: nested })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects an authorization holding a flat payload without the paymentPayload wrapper", async () => {
    const flat = Buffer.from(JSON.stringify({ x402Version: 2, ...signedPayload(QUOTED_AMOUNT) })).toString("base64")
    const { req, res } = setup({ type: "x402", authorization: flat })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it.each([
    ["hex", "0x16e360"],
    ["plus-prefixed", "+1500000"],
    ["padded", " 1500000"],
  ])("rejects a %s signed value even when it equals the quote numerically", async (_label, value) => {
    const { req, res } = setup({ type: "x402", authorization: base64Credential(value) })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("settles exactly the payload the amount check approved", async () => {
    const credential = { type: "x402", x402Version: 2, paymentPayload: signedPayload(QUOTED_AMOUNT) }
    const { req, res } = setup(credential)

    await ucpComplete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
    expect(settledSummary()).toMatchObject({ value: QUOTED_AMOUNT, to: "0xMerchant", network: "eip155:84532" })
    expect(JSON.parse(Buffer.from(settledAuthorization(), "base64").toString("utf-8"))).toEqual(credential)
  })

  it("settles exactly the authorization the amount check approved", async () => {
    const authorization = base64Credential(QUOTED_AMOUNT)
    const { req, res } = setup({ type: "x402", authorization })

    await ucpComplete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
    expect(settledSummary()).toMatchObject({ value: QUOTED_AMOUNT })
    expect(settledAuthorization()).toBe(authorization)
  })
})

describe("declared payment requirements checked against the quote", () => {
  const quotedAccepted = { network: "eip155:84532", asset: "0xAsset", amount: QUOTED_AMOUNT, payTo: "0xMerchant" }

  function authorizationDeclaring(accepted: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) {
    const payload = signedPayload(QUOTED_AMOUNT)
    const { accepted: _declared, ...signedOnly } = payload
    const paymentPayload = { ...(accepted ? { accepted } : {}), ...signedOnly, ...extra }
    return Buffer.from(JSON.stringify({ x402Version: 2, paymentPayload })).toString("base64")
  }

  it("settles when the declared requirements equal the quote", async () => {
    const { req, res } = setup({ type: "x402", authorization: authorizationDeclaring(quotedAccepted) })

    await ucpComplete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["name another amount", { amount: "1" }],
    ["name another recipient", { payTo: "0xAttacker" }],
    ["leave out the amount", { amount: undefined }],
    ["leave out the recipient", { payTo: undefined }],
  ])("rejects declared requirements that %s", async (_label, change) => {
    const { req, res } = setup({ type: "x402", authorization: authorizationDeclaring({ ...quotedAccepted, ...change }) })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects a credential that declares no requirements", async () => {
    const { req, res } = setup({ type: "x402", authorization: authorizationDeclaring(undefined, { network: "eip155:84532" }) })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects declared requirements on a network or token the quote does not list", async () => {
    for (const change of [{ network: "eip155:8453" }, { asset: "0xMainnetUsdc" }]) {
      const { req, res } = setup({ type: "x402", authorization: authorizationDeclaring({ ...quotedAccepted, ...change }) })

      await ucpComplete(req, res)

      expect(completeRun).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(422)
    }
  })

  it("rejects declared requirements that differ from the quote on the ACP route", async () => {
    const { req, res } = setup({})
    req.validatedBody = {
      payment_data: {
        handler_id: HANDLER_ID,
        instrument: { credential: { authorization: authorizationDeclaring({ ...quotedAccepted, amount: "1" }) } },
      },
    }

    await acpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })
})

describe("UCP complete without a usable payment quote", () => {
  const authorization = base64Credential(QUOTED_AMOUNT)

  it.each([
    ["a cart that never got a quote", undefined],
    ["a cart whose quote was cleared", null],
    ["a quote holding no UCP accepts", { preparedAmount: "15", preparedCurrency: "usd", ucp: null }],
  ])("rejects %s", async (_label, quote) => {
    const { req, res } = setup({ type: "x402", authorization }, { quote })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects an unreadable credential on a cart that never got a quote", async () => {
    const { req, res } = setup({ type: "x402", authorization: "abc" }, { quote: undefined })

    await ucpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("does not ask a provider without a Prism quote for one", async () => {
    const { req, res } = setup({ type: "x402", authorization }, { quote: undefined, providerId: "pp_stripe_stripe" })

    await ucpComplete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
  })
})

describe("ACP complete tamper cases", () => {
  const authorization = base64Credential(QUOTED_AMOUNT)

  function acpSetup(
    credentialAuthorization: string,
    options: { quote?: unknown; providerId?: string } = {},
  ) {
    const { req, res } = setup({}, options)
    req.validatedBody = {
      payment_data: { handler_id: HANDLER_ID, instrument: { credential: { authorization: credentialAuthorization } } },
    }
    return { req, res }
  }

  it.each([
    ["a cart that never got a quote", undefined],
    ["a cart whose quote was cleared", null],
    ["a quote holding no ACP accepts", { preparedAmount: "15", preparedCurrency: "usd", acp: null }],
  ])("rejects %s", async (_label, quote) => {
    const { req, res } = acpSetup(authorization, { quote })

    await acpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects a credential whose payment summary cannot be read", async () => {
    const { req, res } = acpSetup("abc")

    await acpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects an authorization signed below the quote", async () => {
    const { req, res } = acpSetup(base64Credential("1"))

    await acpComplete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("settles the authorization the amount check approved", async () => {
    const { req, res } = acpSetup(authorization)

    await acpComplete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
    expect(settledAuthorization()).toBe(authorization)
  })

  it("does not ask a provider without a Prism quote for one", async () => {
    const { req, res } = acpSetup("abc", { quote: undefined, providerId: "pp_stripe_stripe" })

    await acpComplete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
  })
})

describe("payment session data handed to the provider", () => {
  it("carries the cart's stored quote", () => {
    const data = paymentSessionDataFor(
      { ucp_version: "2026-04-08", payment_data: { eip3009_authorization: base64Credential(QUOTED_AMOUNT) } },
      storedQuote,
    )

    expect(data.prism_checkout_data).toEqual(storedQuote)
  })

  it("carries no quote when the cart has none, so the provider fails closed", () => {
    const data = paymentSessionDataFor(
      { ucp_version: "2026-04-08", payment_data: { eip3009_authorization: base64Credential(QUOTED_AMOUNT) } },
      undefined,
    )

    expect(data).not.toHaveProperty("prism_checkout_data")
  })
})

describe("payment session used to complete a UCP checkout", () => {
  const pluginAuthorization = base64Credential(QUOTED_AMOUNT)

  async function runSetup(existingSessions: Record<string, unknown>[], cartOverrides: Record<string, unknown> = {}) {
    const cart = {
      id: "cart_1",
      total: QUOTED_TOTAL,
      currency_code: "usd",
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: existingSessions },
      ...cartOverrides,
    }
    const query = { graph: vi.fn(async () => ({ data: [cart] })) }
    const container = containerFor({ query }, storedQuote)
    paymentFlows.createSessions.mockClear()
    paymentFlows.deleteSessions.mockClear()

    await (setupPaymentStep as unknown as (input: unknown, ctx: unknown) => Promise<unknown>)(
      {
        cart_id: "cart_1",
        payment_provider_id: "pp_prism_prism",
        ucp_version: "2026-04-08",
        payment_data: { eip3009_authorization: pluginAuthorization, x402_version: 2 },
      },
      { container },
    )
  }

  function createdSession() {
    const call = paymentFlows.createSessions.mock.calls[0] as unknown as [{ input: Record<string, any> }]
    return call[0].input
  }

  it("replaces a pending session the buyer created through the store API", async () => {
    await runSetup([{ id: "payses_buyer", status: "pending", provider_id: "pp_prism_prism", data: {} }])

    expect(paymentFlows.deleteSessions).toHaveBeenCalledWith({ input: { ids: ["payses_buyer"] } })
    expect(paymentFlows.createSessions).toHaveBeenCalledTimes(1)
    expect(createdSession()).toMatchObject({
      payment_collection_id: "paycol_1",
      provider_id: "pp_prism_prism",
      data: { eip3009_authorization: pluginAuthorization, prism_checkout_data: storedQuote },
    })
  })

  it("replaces an authorized session it did not create in this completion", async () => {
    await runSetup([
      { id: "payses_old", status: "authorized", provider_id: "pp_system_default", data: {} },
      { id: "payses_err", status: "error", provider_id: "pp_prism_prism", data: {} },
    ])

    expect(paymentFlows.deleteSessions).toHaveBeenCalledWith({ input: { ids: ["payses_old", "payses_err"] } })
    expect(paymentFlows.createSessions).toHaveBeenCalledTimes(1)
    expect(createdSession().provider_id).toBe("pp_prism_prism")
  })

  it("keeps a session already settled with the same credential so a retried completion does not settle twice", async () => {
    await runSetup([
      {
        id: "payses_settled",
        status: "authorized",
        provider_id: "pp_prism_prism",
        data: { eip3009_authorization: pluginAuthorization, prism_tx_id: "0xsettled" },
      },
      { id: "payses_buyer", status: "pending", provider_id: "pp_prism_prism", data: {} },
    ])

    expect(paymentFlows.deleteSessions).toHaveBeenCalledWith({ input: { ids: ["payses_buyer"] } })
    expect(paymentFlows.createSessions).not.toHaveBeenCalled()
  })

  it("replaces an authorized session settled with a different credential", async () => {
    await runSetup([{
      id: "payses_other",
      status: "authorized",
      provider_id: "pp_prism_prism",
      data: { eip3009_authorization: base64Credential("1"), prism_tx_id: "0xother" },
    }])

    expect(paymentFlows.deleteSessions).toHaveBeenCalledWith({ input: { ids: ["payses_other"] } })
    expect(paymentFlows.createSessions).toHaveBeenCalledTimes(1)
  })

  it("replaces an authorized session that names the credential but was never settled", async () => {
    await runSetup([{
      id: "payses_unsettled",
      status: "authorized",
      provider_id: "pp_prism_prism",
      data: { eip3009_authorization: pluginAuthorization },
    }])

    expect(paymentFlows.deleteSessions).toHaveBeenCalledWith({ input: { ids: ["payses_unsettled"] } })
    expect(paymentFlows.createSessions).toHaveBeenCalledTimes(1)
  })

  it("replaces a settled session of another provider", async () => {
    await runSetup([{
      id: "payses_system",
      status: "authorized",
      provider_id: "pp_system_default",
      data: { eip3009_authorization: pluginAuthorization, prism_tx_id: "0xsettled" },
    }])

    expect(paymentFlows.deleteSessions).toHaveBeenCalledWith({ input: { ids: ["payses_system"] } })
    expect(paymentFlows.createSessions).toHaveBeenCalledTimes(1)
  })

  it("creates the session directly when the collection holds none", async () => {
    await runSetup([])

    expect(paymentFlows.deleteSessions).not.toHaveBeenCalled()
    expect(paymentFlows.createSessions).toHaveBeenCalledTimes(1)
  })
})

describe("UCP completion against a cart changed after its quote", () => {
  const pluginAuthorization = base64Credential(QUOTED_AMOUNT)
  const grownTotal = QUOTED_TOTAL + 100 * 1500

  async function completeSetup(
    cart: Record<string, unknown>,
    paymentProviderId = "pp_prism_prism",
    ...override: [quote?: unknown]
  ) {
    const quote = override.length ? override[0] : storedQuote
    const query = { graph: vi.fn(async () => ({ data: [{ id: "cart_1", currency_code: "usd", ...cart }] })) }
    paymentFlows.createCollection.mockClear()
    paymentFlows.createSessions.mockClear()
    paymentFlows.deleteSessions.mockClear()

    return (setupPaymentStep as unknown as (input: unknown, ctx: unknown) => Promise<unknown>)(
      {
        cart_id: "cart_1",
        payment_provider_id: paymentProviderId,
        ucp_version: "2026-04-08",
        payment_data: { eip3009_authorization: pluginAuthorization, x402_version: 2 },
      },
      { container: containerFor({ query }, quote) },
    )
  }

  function expectNothingPrepared() {
    expect(paymentFlows.deleteSessions).not.toHaveBeenCalled()
    expect(paymentFlows.createSessions).not.toHaveBeenCalled()
  }

  it("rejects a cart whose items grew after the quote was signed", async () => {
    await expect(completeSetup({
      total: grownTotal,
      payment_collection: { id: "paycol_1", amount: grownTotal, payment_sessions: [] },
    })).rejects.toThrow(/quote_total_mismatch/)
    expectNothingPrepared()
  })

  it("rejects a cart whose shipping was added after the quote was signed", async () => {
    await expect(completeSetup({
      total: QUOTED_TOTAL + 4.99,
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL + 4.99, payment_sessions: [] },
    })).rejects.toThrow(/quote_total_mismatch/)
    expectNothingPrepared()
  })

  it("rejects a payment collection still holding the quoted amount after the cart grew", async () => {
    await expect(completeSetup({
      total: grownTotal,
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    })).rejects.toThrow(/payment_amount_mismatch/)
    expectNothingPrepared()
  })

  it("rejects a retried completion whose settled session no longer matches the cart total", async () => {
    await expect(completeSetup({
      total: grownTotal,
      payment_collection: {
        id: "paycol_1",
        amount: grownTotal,
        payment_sessions: [{
          id: "payses_settled",
          status: "authorized",
          provider_id: "pp_prism_prism",
          data: { eip3009_authorization: pluginAuthorization, prism_tx_id: "0xsettled" },
        }],
      },
    })).rejects.toThrow(/quote_total_mismatch/)
    expectNothingPrepared()
  })

  it("rejects a Prism completion on a cart that carries no quote", async () => {
    await expect(completeSetup({
      total: QUOTED_TOTAL,
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    }, "pp_prism_prism", undefined)).rejects.toThrow(/missing_payment_quote/)
    expectNothingPrepared()
  })

  it("rejects a quote that does not say which total it was prepared for", async () => {
    const { preparedAmount: _dropped, ...unpriced } = storedQuote
    await expect(completeSetup({
      total: QUOTED_TOTAL,
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    }, "pp_prism_prism", unpriced)).rejects.toThrow(/missing_payment_quote/)
    expectNothingPrepared()
  })

  it("rejects a cart whose total cannot be read", async () => {
    await expect(completeSetup({
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    })).rejects.toThrow(/missing_cart_total/)
    expectNothingPrepared()
  })

  it("rejects a cart whose currency changed after the quote was signed", async () => {
    await expect(completeSetup({
      total: QUOTED_TOTAL,
      currency_code: "jpy",
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    })).rejects.toThrow(/quote_currency_mismatch/)
    expectNothingPrepared()
  })

  it("rejects a quote that does not say which currency it was prepared in", async () => {
    const { preparedCurrency: _dropped, ...unpriced } = storedQuote
    await expect(completeSetup({
      total: QUOTED_TOTAL,
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    }, "pp_prism_prism", unpriced)).rejects.toThrow(/missing_payment_quote/)
    expectNothingPrepared()
  })

  it("rejects a stale payment collection for a provider that takes no Prism quote", async () => {
    await expect(completeSetup({
      total: grownTotal,
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    }, "pp_stripe_stripe", undefined)).rejects.toThrow(/payment_amount_mismatch/)
    expectNothingPrepared()
  })

  it("prepares the payment when quote, cart total and payment amount agree", async () => {
    await completeSetup({
      total: QUOTED_TOTAL,
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    })
    expect(paymentFlows.createSessions).toHaveBeenCalledTimes(1)
  })

  it("refuses to pay a cart that holds no payment collection under the lock", async () => {
    await expect(completeSetup({
      total: QUOTED_TOTAL,
      payment_collection: null,
    })).rejects.toThrow(/no payment collection/)
    expect(paymentFlows.createCollection).not.toHaveBeenCalled()
    expectNothingPrepared()
  })
})

describe("payment captured after a UCP completion", () => {
  const cartWith = (payments: Record<string, unknown>[]) => ({ data: [{ id: "cart_1", payment_collection: { payments } }] })

  it("captures only an open payment of the provider used for this completion", () => {
    expect(paymentToCapture(cartWith([
      { id: "pay_system", provider_id: "pp_system_default" },
      { id: "pay_canceled", provider_id: "pp_prism_prism", canceled_at: "2026-10-09T00:00:00Z" },
      { id: "pay_captured", provider_id: "pp_prism_prism", captured_at: "2026-10-09T00:00:00Z" },
      { id: "pay_prism", provider_id: "pp_prism_prism" },
    ]), "pp_prism_prism")).toBe("pay_prism")
  })

  it("captures nothing when only other providers hold a payment", () => {
    expect(paymentToCapture(cartWith([{ id: "pay_system", provider_id: "pp_system_default" }]), "pp_prism_prism")).toBeNull()
  })
})

describe("payment provider configured for agentic checkout", () => {
  const prismAdapters = { payment_handler_adapters: ["prismPaymentHandler"] }

  beforeEach(() => {
    vi.stubEnv("AGENTIC_PAYMENT_PROVIDER", "")
    vi.stubEnv("NODE_ENV", "development")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("refuses to start without a payment provider", () => {
    expect(() => new AgenticCommerceService({}, prismAdapters)).toThrow("payment_provider_id is required")
  })

  it("refuses the system provider while a payment handler is configured", () => {
    expect(() => new AgenticCommerceService({}, {
      ...prismAdapters,
      payment_provider_id: "pp_system_default",
      allow_system_payment_provider: true,
    })).toThrow("pp_system_default")
  })

  it("refuses the system provider from the environment without an explicit opt-in", () => {
    vi.stubEnv("AGENTIC_PAYMENT_PROVIDER", "pp_system_default")

    expect(() => new AgenticCommerceService({}, {})).toThrow("pp_system_default")
  })

  it.each([["production"], [""], ["staging"]])("refuses the opted-in system provider when NODE_ENV is %j", (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv)

    expect(() => new AgenticCommerceService({}, {
      payment_provider_id: "pp_system_default",
      allow_system_payment_provider: true,
    })).toThrow("pp_system_default")
  })

  it("allows the opted-in system provider for local development without payment handlers", () => {
    const service = new AgenticCommerceService({}, {
      payment_provider_id: "pp_system_default",
      allow_system_payment_provider: true,
    })

    expect(service.getPaymentProviderId()).toBe("pp_system_default")
  })

  it("uses the configured Prism provider", () => {
    expect(new AgenticCommerceService({}, { ...prismAdapters, payment_provider_id: "pp_prism_prism" }).getPaymentProviderId()).toBe("pp_prism_prism")
  })

  it("uses the provider from the environment", () => {
    vi.stubEnv("AGENTIC_PAYMENT_PROVIDER", "pp_prism_prism")

    expect(new AgenticCommerceService({}, prismAdapters).getPaymentProviderId()).toBe("pp_prism_prism")
  })
})
