import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"
import { extractSignedSummary } from "../lib/validate-signed-amount"

const completeRun = vi.hoisted(() => vi.fn(async () => {
  throw new Error("stop after settlement handoff")
}))

vi.mock("../workflows/complete-checkout-session", () => ({
  default: () => ({ run: completeRun }),
}))

import { POST as ucpComplete } from "../api/ucp/checkout-sessions/[id]/complete/route"

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

function settledSummary() {
  const input = (completeRun.mock.calls[0] as unknown as [{ input: { payment_data: { eip3009_authorization: string } } }])[0]
  return extractSignedSummary(input.input.payment_data.eip3009_authorization)
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

  it("settles exactly the payload the amount check approved", async () => {
    const { req, res } = setup({ type: "x402", x402Version: 2, paymentPayload: signedPayload(QUOTED_AMOUNT) })

    await ucpComplete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
    expect(settledSummary()).toMatchObject({ value: QUOTED_AMOUNT, to: "0xMerchant", network: "eip155:84532" })
  })

  it("settles exactly the authorization the amount check approved", async () => {
    const { req, res } = setup({ type: "x402", authorization: base64Credential(QUOTED_AMOUNT) })

    await ucpComplete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
    expect(settledSummary()).toMatchObject({ value: QUOTED_AMOUNT })
  })
})
