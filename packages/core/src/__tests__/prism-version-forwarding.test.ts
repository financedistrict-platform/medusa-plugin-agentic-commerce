import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"
import { fakeAgentSessions } from "./helpers/agent-session-store"

vi.mock("../workflows/create-checkout-session", () => ({
  default: () => ({ run: async () => ({ result: { id: "cart_1" } }) }),
}))
const completeRun = vi.hoisted(() => vi.fn(async () => {
  throw new Error("stop after capture")
}))

vi.mock("../workflows/complete-checkout-session", () => ({
  default: () => ({ run: completeRun }),
}))
vi.mock("../workflows/update-checkout-session", () => ({
  default: () => ({ run: async () => ({}) }),
}))

import { POST as ucpCreate } from "../api/ucp/checkout-sessions/route"
import { PUT as ucpUpdate } from "../api/ucp/checkout-sessions/[id]/route"
import { POST as acpCreate } from "../api/acp/checkout_sessions/route"
import { POST as acpUpdate } from "../api/acp/checkout_sessions/[id]/route"
import { POST as ucpComplete } from "../api/ucp/checkout-sessions/[id]/complete/route"
import { POST as acpComplete } from "../api/acp/checkout_sessions/[id]/complete/route"
import { GET as acpWellKnown } from "../api/well-known/acp.json/route"

const HANDLER_ID = "xyz.fd.prism_payment"
const quote = {
  config: { x402Version: 2, accepts: [{ network: "eip155:84532", asset: "0xasset", amount: "1500000", payTo: "0xmerchant" }] },
}
const storedQuote = { ucp: { [HANDLER_ID]: [{ id: HANDLER_ID, ...quote }] }, acp: quote }
const signedAuthorization = Buffer.from(JSON.stringify({
  x402Version: 2,
  paymentPayload: {
    accepted: { network: "eip155:84532", asset: "0xAsset", amount: "1500000", payTo: "0xMerchant" },
    payload: { authorization: { from: "0x2222222222222222222222222222222222222222", nonce: "0x0101010101010101010101010101010101010101010101010101010101010101", value: "1500000", to: "0xMerchant" } },
  },
})).toString("base64")

const CURRENT = "2026-04-08"
const REQUESTED = "2026-01-23"

function setup(ucp?: { version: string }) {
  const { service } = createStoreService({ version: CURRENT, supported: ["2026-08-25", REQUESTED] })
  const prepareCheckoutPayment = vi.fn().mockResolvedValue({})
  const getAcpDiscoveryHandlers = vi.fn().mockResolvedValue([])
  ;(service as any).getPaymentHandlerService = () => ({ prepareCheckoutPayment, getAcpDiscoveryHandlers })
  const cart = { id: "cart_1", items: [], metadata: {} }
  const query = { graph: vi.fn(async () => ({ data: [cart] })) }
  const agenticCommerceSession = fakeAgentSessions([{ cart_id: "cart_1", handler_data: { [HANDLER_ID]: storedQuote } }])
  completeRun.mockClear()
  const req = {
    ...createRequest({ agenticCommerce: service, query, agenticCommerceSession }, { id: "cart_1" }),
    validatedBody: {},
    ucp,
  }
  return { req: req as any, res: createResponse() as any, prepareCheckoutPayment, getAcpDiscoveryHandlers }
}

describe("UCP checkout routes", () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup({ version: REQUESTED })
  })

  it("create forwards the request UCP version to prepareCheckoutPayment", async () => {
    await ucpCreate(ctx.req, ctx.res)
    expect(ctx.prepareCheckoutPayment).toHaveBeenCalledWith(expect.objectContaining({ ucpVersion: REQUESTED }))
  })

  it("update forwards the request UCP version to prepareCheckoutPayment", async () => {
    await ucpUpdate(ctx.req, ctx.res)
    expect(ctx.prepareCheckoutPayment).toHaveBeenCalledWith(expect.objectContaining({ ucpVersion: REQUESTED }))
  })

  it("complete hands the request UCP version to the payment session", async () => {
    ctx.req.body = {
      payment: {
        instruments: [{ id: "i1", handler_id: "xyz.fd.prism_payment", type: "x402", credential: { type: "x402", authorization: signedAuthorization } }],
      },
    }
    await ucpComplete(ctx.req, ctx.res)
    expect(completeRun).toHaveBeenCalledWith({ input: expect.objectContaining({ ucp_version: REQUESTED }) })
  })
})

describe("ACP routes", () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup()
  })

  it("create forwards the store's current UCP version", async () => {
    ctx.req.headers = { ...ctx.req.headers, authorization: "Bearer key-a" }
    await acpCreate(ctx.req, ctx.res)
    expect(ctx.prepareCheckoutPayment).toHaveBeenCalledWith(expect.objectContaining({ ucpVersion: CURRENT }))
  })

  it("update forwards the store's current UCP version", async () => {
    await acpUpdate(ctx.req, ctx.res)
    expect(ctx.prepareCheckoutPayment).toHaveBeenCalledWith(expect.objectContaining({ ucpVersion: CURRENT }))
  })

  it("complete hands the store's current UCP version to the payment session", async () => {
    ctx.req.validatedBody = { payment_data: { handler_id: "xyz.fd.prism_payment", instrument: { credential: { authorization: signedAuthorization } } } }
    await acpComplete(ctx.req, ctx.res)
    expect(completeRun).toHaveBeenCalledWith({ input: expect.objectContaining({ ucp_version: CURRENT }) })
  })

  it("discovery asks for handlers with the store's current UCP version", async () => {
    await acpWellKnown(ctx.req, ctx.res)
    expect(ctx.getAcpDiscoveryHandlers).toHaveBeenCalledWith(CURRENT)
  })
})
