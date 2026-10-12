import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Modules } from "@medusajs/framework/utils"

const completeRun = vi.hoisted(() => vi.fn())
const refreshRun = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock("../workflows/complete-checkout-session", () => ({ default: () => ({ run: completeRun }) }))
vi.mock("@medusajs/medusa/core-flows", () => ({
  refreshPaymentCollectionForCartWorkflow: () => ({ run: refreshRun }),
}))
vi.mock("../lib/settled-payment-record", () => ({
  recordSettledPayment: async (_scope: unknown, _id: string, cart: unknown) => cart,
  settledSessionData: () => ({ transaction_reference: "0xtx", transaction_status: "settled" }),
}))

import { POST as ucpComplete } from "../api/ucp/checkout-sessions/[id]/complete/route"
import { createIdempotencyMiddleware } from "../api/middleware/idempotency"
import { PAYMENT_AUTHORIZATION_USED } from "../lib/payment-ledger"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"

const COMPLETE_BODY = {
  payment: {
    instruments: [{ id: "inst_1", handler_id: "com.example.pay", type: "x402", credential: { type: "x402", paymentPayload: { x: 1 } } }],
  },
}

const completedCart = { id: "cart_1", completed_at: "2026-10-12T00:00:00Z", order: { id: "order_1" }, items: [], metadata: {} }

function stack() {
  const { service } = createStoreService({ version: "2026-04-08" })
  ;(service as any).getPaymentProviderId = () => "pp_other_other"
  const cache = new Map<string, unknown>()
  const cacheModule = {
    get: async (key: string) => cache.get(key) ?? null,
    set: async (key: string, value: unknown) => { cache.set(key, value) },
    invalidate: async (key: string) => { cache.delete(key) },
  }
  const services: Record<string, unknown> = {
    agenticCommerce: service,
    query: { graph: vi.fn(async () => ({ data: [completedCart] })) },
    agenticCommerceSession: { find: async () => ({ cart_id: "cart_1", handler_data: {} }) },
    [Modules.CACHE]: cacheModule,
  }
  const middleware = createIdempotencyMiddleware({ required: true, protocol: "ucp" })

  async function post(idempotencyKey: string) {
    const req: any = {
      ...createRequest(services, { id: "cart_1" }),
      method: "POST",
      path: "/ucp/checkout-sessions/cart_1/complete",
      headers: { host: "store.test", "idempotency-key": idempotencyKey, "ucp-agent": 'agent/1.0; profile="https://agent.example/profile.json"' },
      body: COMPLETE_BODY,
    }
    const res: any = createResponse()
    let route: Promise<void> | undefined
    await middleware(req, res, () => { route = ucpComplete(req, res) })
    await route
    return res
  }

  return { post }
}

const duplicate = { type: "duplicate_error", message: "Checkout session has already been completed", name: "MedusaError" }

beforeEach(() => {
  completeRun.mockReset()
  refreshRun.mockClear()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("completing a UCP session twice", () => {
  it("answers 409 already_completed instead of a payment failure", async () => {
    completeRun.mockRejectedValue(duplicate)
    const res = await stack().post("key-repeat")

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({
      ucp: { status: "error" },
      messages: [{ type: "error", code: "already_completed", severity: "unrecoverable" }],
    })
  })

  it("does not touch the payment collection after the refusal", async () => {
    completeRun.mockRejectedValue(duplicate)
    await stack().post("key-repeat")

    expect(completeRun).toHaveBeenCalledTimes(1)
    expect(refreshRun).not.toHaveBeenCalled()
  })

  it("keeps replaying the original response for the same Idempotency-Key and body", async () => {
    completeRun.mockResolvedValueOnce({ result: { cart_id: "cart_1", order_id: "order_1" } })
    const { post } = stack()

    const first = await post("key-original")
    completeRun.mockRejectedValue(duplicate)
    const replay = await post("key-original")
    const repeat = await post("key-new")

    expect(first.statusCode).toBe(200)
    expect(first.body).toMatchObject({ status: "completed", order: { id: "order_1" } })
    expect(replay.statusCode).toBe(200)
    expect(replay.headers["idempotent-replayed"]).toBe("true")
    expect(replay.body).toEqual(first.body)
    expect(completeRun).toHaveBeenCalledTimes(2)
    expect(repeat.statusCode).toBe(409)
  })

  it("still refuses a reused payment authorization with 409 payment_authorization_used", async () => {
    completeRun.mockRejectedValue({ type: "conflict", code: PAYMENT_AUTHORIZATION_USED, message: "used" })
    const res = await stack().post("key-reuse")

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ messages: [{ code: PAYMENT_AUTHORIZATION_USED }] })
    expect(refreshRun).toHaveBeenCalledTimes(1)
  })

  it("still reports other failures as 422 payment_failed and refreshes the payment state", async () => {
    completeRun.mockRejectedValue(new Error("gateway down"))
    const res = await stack().post("key-failure")

    expect(res.statusCode).toBe(422)
    expect(res.body).toMatchObject({ messages: [{ code: "payment_failed" }] })
    expect(refreshRun).toHaveBeenCalledTimes(1)
  })
})
