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
import { PAYMENT_AUTHORIZATION_USED, PAYMENT_PENDING_MISMATCH, SETTLEMENT_UNDER_REVIEW } from "../lib/payment-ledger"
import { fakeAgentSessions } from "./helpers/agent-session-store"
import { guardPendingSettlement } from "../workflows/steps/guard-pending-settlement"
import { beginSettlementAttempt, compensateSettlementAttempt } from "../workflows/steps/begin-settlement-attempt"
import { markProviderCalled } from "../workflows/steps/mark-provider-called"
import settleFixture from "../../../prism-payment/src/__fixtures__/settle-replies.json"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"

const COMPLETE_BODY = {
  payment: {
    instruments: [{ id: "inst_1", handler_id: "com.example.pay", type: "x402", credential: { type: "x402", paymentPayload: { x: 1 } } }],
  },
}

const OTHER_COMPLETE_BODY = {
  payment: {
    instruments: [{ id: "inst_1", handler_id: "com.example.pay", type: "x402", credential: { type: "x402", paymentPayload: { x: 2 } } }],
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

describe("completing a UCP session whose settlement is still open", () => {
  const openCart = { id: "cart_1", completed_at: null, items: [], metadata: {} }

  function settlementStack(sessions = fakeAgentSessions([{ cart_id: "cart_1" }])) {
    const { service } = createStoreService({ version: "2026-04-08" })
    ;(service as any).getPaymentProviderId = () => "pp_other_other"
    const cache = new Map<string, unknown>()
    let paymentSessions: Record<string, unknown>[] = []
    const services: Record<string, unknown> = {
      agenticCommerce: service,
      query: { graph: vi.fn(async () => ({ data: [{ ...openCart, payment_collection: { payment_sessions: paymentSessions } }] })) },
      agenticCommerceSession: sessions,
      [Modules.CACHE]: {
        get: async (key: string) => cache.get(key) ?? null,
        set: async (key: string, value: unknown) => { cache.set(key, value) },
        invalidate: async (key: string) => { cache.delete(key) },
      },
    }
    const container = { resolve: (name: string) => services[name] }
    const middleware = createIdempotencyMiddleware({ required: true, protocol: "ucp" })

    function failSettleWith(sessionData: Record<string, unknown> | null) {
      completeRun.mockImplementationOnce(async ({ input }: { input: { cart_id: string; payment_data: { eip3009_authorization: string } } }) => {
        const settlement = await guardPendingSettlement(input, container)
        const attempt = await beginSettlementAttempt({ ...input, resumed: settlement.resumed }, container)
        paymentSessions = sessionData ? [{ id: "ps_1", data: { credential_sha256: attempt.credential_sha256, ...sessionData } }] : []
        await compensateSettlementAttempt(attempt, container)
        throw new Error("Payment authorization failed")
      })
    }

    function failAfterProviderCalled() {
      completeRun.mockImplementationOnce(async ({ input }: { input: { cart_id: string; payment_data: { eip3009_authorization: string } } }) => {
        const settlement = await guardPendingSettlement(input, container)
        const attempt = await beginSettlementAttempt({ ...input, resumed: settlement.resumed }, container)
        await markProviderCalled(input.cart_id, container)
        paymentSessions = [{ id: "ps_1", status: "pending", data: { credential_sha256: attempt.credential_sha256 } }]
        await compensateSettlementAttempt(attempt, container)
        throw new Error("could not save the authorized payment session")
      })
    }

    function guardOnly() {
      completeRun.mockImplementationOnce(async ({ input }: { input: { cart_id: string; payment_data: { eip3009_authorization: string } } }) => {
        await guardPendingSettlement(input, container)
        throw new Error("the guard let a new credential through")
      })
    }

    async function post(idempotencyKey: string, body: unknown = COMPLETE_BODY) {
      const req: any = {
        ...createRequest(services, { id: "cart_1" }),
        method: "POST",
        path: "/ucp/checkout-sessions/cart_1/complete",
        headers: { host: "store.test", "idempotency-key": idempotencyKey, "ucp-agent": 'agent/1.0; profile="https://agent.example/profile.json"' },
        body,
      }
      const res: any = createResponse()
      let route: Promise<void> | undefined
      await middleware(req, res, () => { route = ucpComplete(req, res) })
      await route
      return res
    }

    return { post, failSettleWith, failAfterProviderCalled, guardOnly, sessions }
  }

  const marker = (state: "settling" | "pending" | "review", overrides: Record<string, unknown> = {}) => ({
    state,
    credential_sha256: "d1",
    resumed: false,
    started_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
    ...overrides,
  })

  it.each([["settling"], ["pending"]] as const)("answers 202 complete_in_progress when the marker is %s", async (state) => {
    completeRun.mockRejectedValue(new Error("gateway down"))
    const res = await settlementStack(fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: marker(state) }])).post(`key-${state}`)

    expect(res.statusCode).toBe(202)
    expect(res.body).toMatchObject({ id: "cart_1", status: "complete_in_progress", messages: [{ code: "settlement_pending" }] })
    expect(refreshRun).not.toHaveBeenCalled()
  })

  it("answers 200 requires_escalation when the settlement is held for review", async () => {
    completeRun.mockRejectedValue(new Error("gateway down"))
    const res = await settlementStack(fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: marker("review") }])).post("key-review")

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ status: "requires_escalation", messages: [{ code: "payment_requires_review" }] })
    expect(refreshRun).not.toHaveBeenCalled()
  })

  it("answers 200 requires_escalation when the workflow refuses a completion under review", async () => {
    completeRun.mockRejectedValue({ type: "conflict", code: SETTLEMENT_UNDER_REVIEW, message: "review" })
    const res = await settlementStack(fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: marker("review") }])).post("key-review-error")

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ status: "requires_escalation", messages: [{ code: "payment_requires_review" }] })
  })

  it("answers 409 payment_pending_mismatch for a different credential", async () => {
    completeRun.mockRejectedValue({ type: "conflict", code: PAYMENT_PENDING_MISMATCH, message: "mismatch" })
    const res = await settlementStack(fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: marker("pending") }])).post("key-mismatch")

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ messages: [{ code: PAYMENT_PENDING_MISMATCH }] })
    expect(refreshRun).not.toHaveBeenCalled()
  })

  it("keeps 422 payment_failed and the refresh when no settlement is open", async () => {
    completeRun.mockRejectedValue(new Error("gateway down"))
    const res = await settlementStack().post("key-none")

    expect(res.statusCode).toBe(422)
    expect(res.body).toMatchObject({ messages: [{ code: "payment_failed" }] })
    expect(refreshRun).toHaveBeenCalledTimes(1)
  })

  it("answers 422 only for the declined replies of the shared fixture", async () => {
    const statuses: number[] = []
    for (const row of settleFixture.rows) {
      const stack = settlementStack()
      stack.failSettleWith({ settlement_state: row.first })
      statuses.push((await stack.post(`key-${row.name}`)).statusCode)
    }

    const declined = settleFixture.rows.filter((row) => row.first === "declined").length
    expect(declined).toBe(6)
    expect(statuses.filter((status) => status === 422)).toHaveLength(declined)
    expect(statuses.filter((status) => status !== 422).every((status) => status === 202 || status === 200)).toBe(true)
  })

  it("completes on a retry with the same credential after a pending answer", async () => {
    const stack = settlementStack()
    stack.failSettleWith({ settlement_state: "pending", unreconciled_transaction: "0xaa" })

    const first = await stack.post("key-first")
    completeRun.mockResolvedValueOnce({ result: { cart_id: "cart_1", order_id: "order_1" } })
    const retry = await stack.post("key-retry")

    expect(first.statusCode).toBe(202)
    expect(retry.statusCode).toBe(200)
    expect(retry.body).toMatchObject({ status: "completed", order: { id: "order_1" } })
  })

  it("holds the settlement for review when the provider settled but its answer was never saved, and refuses a new credential", async () => {
    const stack = settlementStack()
    stack.failSettleWith({ settlement_state: "pending", unreconciled_transaction: "0xaa" })
    await stack.post("key-first")

    stack.failAfterProviderCalled()
    const lost = await stack.post("key-lost")

    expect(lost.statusCode).toBe(200)
    expect(lost.body).toMatchObject({ status: "requires_escalation", messages: [{ code: "payment_requires_review" }] })
    expect(stack.sessions.rows.get("cart_1")?.pending_settlement).toMatchObject({ state: "review", transaction: "0xaa", reason: "provider_called_outcome_unsaved" })

    stack.guardOnly()
    const other = await stack.post("key-other", OTHER_COMPLETE_BODY)

    expect(other.statusCode).toBe(200)
    expect(other.body).toMatchObject({ status: "requires_escalation", messages: [{ code: "payment_requires_review" }] })
    expect(stack.sessions.rows.get("cart_1")?.pending_settlement).toMatchObject({ state: "review", transaction: "0xaa" })
  })

  it("holds a first attempt for review when the provider was called but its answer was never saved", async () => {
    const stack = settlementStack()
    stack.failAfterProviderCalled()

    const lost = await stack.post("key-first-lost")

    expect(lost.statusCode).toBe(200)
    expect(lost.body).toMatchObject({ status: "requires_escalation" })
    expect(stack.sessions.rows.get("cart_1")?.pending_settlement).toMatchObject({ state: "review", resumed: false, transaction: null })
  })

  it("keeps the transaction when a resumed settle is rate limited", async () => {
    const stack = settlementStack()
    stack.failSettleWith({ settlement_state: "pending", unreconciled_transaction: "0xaa" })
    await stack.post("key-first")

    stack.failSettleWith({ settlement_state: "pending" })
    const resumed = await stack.post("key-resume")

    expect(resumed.statusCode).toBe(202)
    expect(stack.sessions.rows.get("cart_1")?.pending_settlement).toMatchObject({ state: "pending", resumed: true, transaction: "0xaa" })
  })
})
