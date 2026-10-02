import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"

vi.mock("../workflows/create-checkout-session", () => ({
  default: () => ({ run: async () => ({ result: { id: "cart_1" } }) }),
}))
vi.mock("../workflows/update-checkout-session", () => ({
  default: () => ({ run: async () => ({}) }),
}))

import { POST as ucpCreate } from "../api/ucp/checkout-sessions/route"
import { PUT as ucpUpdate } from "../api/ucp/checkout-sessions/[id]/route"
import { POST as acpCreate } from "../api/acp/checkout_sessions/route"
import { POST as acpUpdate } from "../api/acp/checkout_sessions/[id]/route"
import { GET as acpWellKnown } from "../api/well-known/acp.json/route"

const CURRENT = "2026-04-08"
const REQUESTED = "2026-01-23"

function setup(ucp?: { version: string }) {
  const { service } = createStoreService({ version: CURRENT, supported: ["2026-08-25", REQUESTED] })
  const prepareCheckoutPayment = vi.fn().mockResolvedValue({})
  const getAcpDiscoveryHandlers = vi.fn().mockResolvedValue([])
  ;(service as any).getPaymentHandlerService = () => ({ prepareCheckoutPayment, getAcpDiscoveryHandlers })
  const cart = { id: "cart_1", items: [], metadata: {} }
  const query = { graph: vi.fn(async () => ({ data: [cart], metadata: {} })) }
  const req = {
    ...createRequest({ agenticCommerce: service, query }, { id: "cart_1" }),
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
})

describe("ACP routes", () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup()
  })

  it("create forwards the store's current UCP version", async () => {
    await acpCreate(ctx.req, ctx.res)
    expect(ctx.prepareCheckoutPayment).toHaveBeenCalledWith(expect.objectContaining({ ucpVersion: CURRENT }))
  })

  it("update forwards the store's current UCP version", async () => {
    await acpUpdate(ctx.req, ctx.res)
    expect(ctx.prepareCheckoutPayment).toHaveBeenCalledWith(expect.objectContaining({ ucpVersion: CURRENT }))
  })

  it("discovery asks for handlers with the store's current UCP version", async () => {
    await acpWellKnown(ctx.req, ctx.res)
    expect(ctx.getAcpDiscoveryHandlers).toHaveBeenCalledWith(CURRENT)
  })
})
