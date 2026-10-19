import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const completeRun = vi.hoisted(() => vi.fn())
const refreshRun = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock("../workflows/complete-checkout-session", () => ({ default: () => ({ run: completeRun }) }))
vi.mock("@medusajs/medusa/core-flows", () => ({
  refreshPaymentCollectionForCartWorkflow: () => ({ run: refreshRun }),
}))

import { POST as acpComplete } from "../api/acp/checkout_sessions/[id]/complete/route"
import { PAYMENT_PENDING_MISMATCH, SETTLEMENT_UNDER_REVIEW } from "../lib/payment-ledger"
import type { PendingSettlementRecord } from "../lib/agent-session"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"
import { fakeAgentSessions } from "./helpers/agent-session-store"

const marker = (state: PendingSettlementRecord["state"]): PendingSettlementRecord => ({
  state,
  credential_sha256: "d1",
  resumed: false,
  started_at: "2026-10-19T00:00:00.000Z",
  updated_at: "2026-10-19T00:00:00.000Z",
})

async function complete(pending: PendingSettlementRecord | null) {
  const { service } = createStoreService({ version: "2026-04-08" })
  ;(service as any).getPaymentProviderId = () => "pp_other_other"
  const services: Record<string, unknown> = {
    agenticCommerce: service,
    query: { graph: vi.fn(async () => ({ data: [{ id: "cart_1", items: [], metadata: {} }] })) },
    agenticCommerceSession: fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: pending }]),
  }
  const req: any = {
    ...createRequest(services, { id: "cart_1" }),
    validatedBody: { payment_data: { handler_id: "com.example.pay", instrument: { credential: { authorization: "Y3JlZA==" } } } },
  }
  const res: any = createResponse()
  await acpComplete(req, res)
  return res
}

beforeEach(() => {
  completeRun.mockReset()
  refreshRun.mockClear()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("completing an ACP session whose settlement is still open", () => {
  it.each([["settling"], ["pending"]] as const)("answers 409 settlement_pending when the marker is %s", async (state) => {
    completeRun.mockRejectedValue(new Error("Payment authorization failed"))

    const res = await complete(marker(state))

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ code: "settlement_pending" })
    expect(refreshRun).not.toHaveBeenCalled()
  })

  it("answers 409 payment_requires_review when the settlement is held for review", async () => {
    completeRun.mockRejectedValue(new Error("Payment authorization failed"))

    const res = await complete(marker("review"))

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ code: "payment_requires_review" })
  })

  it("answers 409 payment_requires_review when the workflow refuses a completion under review", async () => {
    completeRun.mockRejectedValue({ type: "conflict", code: SETTLEMENT_UNDER_REVIEW, message: "review" })

    const res = await complete(marker("review"))

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ code: "payment_requires_review" })
  })

  it("answers 409 payment_pending_mismatch for a different credential", async () => {
    completeRun.mockRejectedValue({ type: "conflict", code: PAYMENT_PENDING_MISMATCH, message: "mismatch" })

    const res = await complete(marker("pending"))

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ code: PAYMENT_PENDING_MISMATCH })
    expect(refreshRun).not.toHaveBeenCalled()
  })

  it("never answers 422 while a marker exists", async () => {
    for (const state of ["settling", "pending", "review"] as const) {
      completeRun.mockRejectedValue({ type: "invalid_data", message: "bad" })
      expect((await complete(marker(state))).statusCode).toBe(409)
    }
  })

  it("keeps the existing mapping when no settlement is open", async () => {
    completeRun.mockRejectedValue(new Error("gateway down"))

    const res = await complete(null)

    expect(res.statusCode).toBe(500)
    expect(refreshRun).toHaveBeenCalledTimes(1)
  })
})
