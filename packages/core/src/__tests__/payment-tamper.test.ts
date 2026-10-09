import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"
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
import { setupPaymentStep } from "../workflows/steps/setup-payment"
import { paymentToCapture } from "../lib/payment-to-capture"

const HANDLER_ID = "xyz.fd.prism_payment"
const QUOTED_AMOUNT = "1500000"

const quotedMetadata = {
  prism_checkout_data: {
    ucp: {
      [HANDLER_ID]: [{
        id: HANDLER_ID,
        config: {
          x402Version: 2,
          accepts: [{ network: "eip155:84532", asset: "0xasset", amount: QUOTED_AMOUNT, payTo: "0xmerchant" }],
        },
      }],
    },
  },
}

function signedPayload(value: string) {
  return {
    accepted: { network: "eip155:84532", asset: "0xAsset" },
    payload: {
      signature: "0xsig",
      authorization: { from: "0xBuyer", to: "0xMerchant", value, validAfter: "0", validBefore: "9999999999", nonce: "0x01" },
    },
  }
}

function base64Credential(value: string) {
  return Buffer.from(JSON.stringify({ x402Version: 2, paymentPayload: signedPayload(value) })).toString("base64")
}

function setup(credential: Record<string, unknown>) {
  const { service } = createStoreService({ version: "2026-04-08" })
  ;(service as any).getPaymentProviderId = () => "pp_prism_prism"
  const cart = { id: "cart_1", items: [], metadata: quotedMetadata }
  const query = { graph: vi.fn(async () => ({ data: [cart], metadata: {} })) }
  completeRun.mockClear()
  const req = {
    ...createRequest({ agenticCommerce: service, query }, { id: "cart_1" }),
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

describe("payment session data handed to the provider", () => {
  it("carries the cart's stored quote from server-side metadata", () => {
    const data = paymentSessionDataFor(
      { ucp_version: "2026-04-08", payment_data: { eip3009_authorization: base64Credential(QUOTED_AMOUNT) } },
      quotedMetadata,
    )

    expect(data.prism_checkout_data).toEqual(quotedMetadata.prism_checkout_data)
  })

  it("carries no quote when the cart has none, so the provider fails closed", () => {
    const data = paymentSessionDataFor(
      { ucp_version: "2026-04-08", payment_data: { eip3009_authorization: base64Credential(QUOTED_AMOUNT) } },
      {},
    )

    expect(data).not.toHaveProperty("prism_checkout_data")
  })
})

describe("payment session used to complete a UCP checkout", () => {
  const pluginAuthorization = base64Credential(QUOTED_AMOUNT)

  async function runSetup(existingSessions: Record<string, unknown>[]) {
    const cart = {
      id: "cart_1",
      metadata: quotedMetadata,
      payment_collection: { id: "paycol_1", payment_sessions: existingSessions },
    }
    const query = { graph: vi.fn(async () => ({ data: [cart] })) }
    const container = { resolve: () => query }
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
      data: { eip3009_authorization: pluginAuthorization, prism_checkout_data: quotedMetadata.prism_checkout_data },
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
