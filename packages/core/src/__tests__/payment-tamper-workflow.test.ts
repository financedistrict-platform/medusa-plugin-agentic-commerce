import { describe, it, expect, vi } from "vitest"
import { WorkflowManager } from "@medusajs/framework/orchestration"
import { completionPaymentData } from "../workflows/complete-checkout-session"
import { guardPendingSettlement } from "../workflows/steps/guard-pending-settlement"
import { isSettledWithSameCredential, paymentSessionDataFor } from "../workflows/steps/setup-payment"
import { isPaymentPendingMismatch, isSettlementUnderReview } from "../lib/payment-ledger"
import { credentialSha256 } from "../lib/credential-digest"
import type { PendingSettlementRecord } from "../lib/agent-session"
import { fakeAgentSessions } from "./helpers/agent-session-store"
import { beginSettlementAttempt, compensateSettlementAttempt } from "../workflows/steps/begin-settlement-attempt"
import { clearSettlementAttempt } from "../workflows/steps/clear-settlement-attempt"
import { markProviderCalled } from "../workflows/steps/mark-provider-called"
import "@medusajs/medusa/core-flows"

type FlowNode = { action?: string; next?: FlowNode | FlowNode[] }

function stepOrder(node: FlowNode | FlowNode[] | undefined): string[] {
  if (!node) return []
  return (Array.isArray(node) ? node : [node]).flatMap((n) => [
    ...(n.action ? [n.action] : []),
    ...stepOrder(n.next),
  ])
}

describe("UCP completion holds the cart lock from the total check to the order", () => {
  const workflow = WorkflowManager.getWorkflow("complete-checkout-session") as unknown as { flow_: FlowNode }
  const steps = stepOrder(workflow.flow_)
  const at = (action: string) => {
    const index = steps.indexOf(action)
    expect(index, `${action} in ${steps.join(" > ")}`).toBeGreaterThanOrEqual(0)
    return index
  }

  it("takes the cart lock in this workflow, since a nested cart completion skips its own lock", () => {
    expect(at("acquire-lock-step")).toBeLessThan(at("setup-payment"))
    expect(at("setup-payment")).toBeLessThan(at("complete-cart-as-step"))
  })

  it("binds the authorization to the cart under the lock, before any payment session or order is created", () => {
    expect(at("acquire-lock-step")).toBeLessThan(at("reserve-payment-authorization"))
    expect(at("reserve-payment-authorization")).toBeLessThan(at("setup-payment"))
    expect(at("reserve-payment-authorization")).toBeLessThan(at("complete-cart-as-step"))
  })

  it("adds shipping and creates the payment collection before the lock, since both take the cart lock themselves", () => {
    expect(at("ensure-shipping-method")).toBeLessThan(at("acquire-lock-step"))
    expect(at("ensure-payment-collection")).toBeLessThan(at("acquire-lock-step"))
  })

  it("records the provider call after every non-payment step of the cart completion and right before the payment is authorized", () => {
    const completeCart = stepOrder((WorkflowManager.getWorkflow("complete-cart") as unknown as { flow_: FlowNode }).flow_)
    const position = (action: string) => {
      const index = completeCart.indexOf(action)
      expect(index, `${action} in ${completeCart.join(" > ")}`).toBeGreaterThanOrEqual(0)
      return index
    }
    expect(position("create-orders")).toBeLessThan(position("beforePaymentAuthorization"))
    expect(position("reserve-inventory-step")).toBeLessThan(position("beforePaymentAuthorization"))
    expect(position("beforePaymentAuthorization")).toBeLessThan(position("authorize-payment-session-step"))
  })

  it("releases the cart lock only after the payment is captured", () => {
    expect(at("capture-payment-workflow-as-step")).toBeLessThan(at("release-lock-step"))
  })
})

const CREDENTIAL = Buffer.from(JSON.stringify({ x402Version: 2, paymentPayload: { payload: { signature: "0xsig" } } })).toString("base64")
const OTHER_CREDENTIAL = Buffer.from("other").toString("base64")

const pendingMarker = (overrides: Partial<PendingSettlementRecord> = {}): PendingSettlementRecord => ({
  state: "pending",
  credential_sha256: credentialSha256(CREDENTIAL),
  resumed: false,
  started_at: "2026-10-19T00:00:00.000Z",
  updated_at: "2026-10-19T00:00:00.000Z",
  ...overrides,
})

function containerWith(sessions: ReturnType<typeof fakeAgentSessions>, services: Record<string, unknown> = {}) {
  const all: Record<string, unknown> = { agenticCommerceSession: sessions, ...services }
  return { resolve: (name: string) => all[name] }
}

describe("a retried completion while a settlement is open", () => {
  const guard = (marker: PendingSettlementRecord | null, credential?: string) =>
    guardPendingSettlement(
      { cart_id: "cart_1", payment_data: credential ? { eip3009_authorization: credential } : undefined },
      containerWith(fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: marker }])),
    )

  it("resumes the settlement for the same credential", async () => {
    expect(await guard(pendingMarker(), CREDENTIAL)).toEqual({ resumed: true })
    expect(await guard(pendingMarker({ state: "settling" }), CREDENTIAL)).toEqual({ resumed: true })
  })

  it("refuses a different credential while a settlement is pending", async () => {
    const error = await guard(pendingMarker(), OTHER_CREDENTIAL).catch((caught: unknown) => caught)

    expect(isPaymentPendingMismatch(error)).toBe(true)
    expect(isSettlementUnderReview(error)).toBe(false)
  })

  it("refuses any completion while the settlement is held for review", async () => {
    const error = await guard(pendingMarker({ state: "review" }), CREDENTIAL).catch((caught: unknown) => caught)

    expect(isSettlementUnderReview(error)).toBe(true)
  })

  it("starts a first attempt when no settlement is open", async () => {
    expect(await guard(null, CREDENTIAL)).toEqual({ resumed: false })
  })
})

describe("payment session data written by the checkout", () => {
  it("writes the credential digest and a resume flag only from the server decision", () => {
    const fresh = paymentSessionDataFor({ ucp_version: "2026-04-08", payment_data: { eip3009_authorization: CREDENTIAL, settlement_resume: true } }, undefined)
    const resumed = paymentSessionDataFor({ ucp_version: "2026-04-08", payment_data: { eip3009_authorization: CREDENTIAL }, resumed: true }, undefined)

    expect(fresh.credential_sha256).toBe(credentialSha256(CREDENTIAL))
    expect(fresh).not.toHaveProperty("settlement_resume")
    expect(resumed).toMatchObject({ credential_sha256: credentialSha256(CREDENTIAL), settlement_resume: true })
  })

  it("recognizes a session settled with the same credential by its digest alone", () => {
    const session = { id: "ps_1", status: "authorized", provider_id: "pp_prism_prism", data: { credential_sha256: credentialSha256(CREDENTIAL), prism_tx_id: "0xtx" } }

    expect(isSettledWithSameCredential(session, { payment_provider_id: "pp_prism_prism", payment_data: { eip3009_authorization: CREDENTIAL } })).toBe(true)
    expect(isSettledWithSameCredential(session, { payment_provider_id: "pp_prism_prism", payment_data: { eip3009_authorization: OTHER_CREDENTIAL } })).toBe(false)
  })

  it("computes one digest for the guard, the session data and the provider result", async () => {
    const sessionData = paymentSessionDataFor({ ucp_version: "2026-04-08", payment_data: { eip3009_authorization: CREDENTIAL } }, undefined)
    const authorizePayment = async ({ data }: { data: Record<string, unknown> }) => ({ data, status: "error" })
    const provided = await authorizePayment({ data: sessionData })

    expect(await guardPendingSettlement(
      { cart_id: "cart_1", payment_data: { eip3009_authorization: CREDENTIAL } },
      containerWith(fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: pendingMarker({ credential_sha256: provided.data.credential_sha256 as string }) }])),
    )).toEqual({ resumed: true })
  })

  it("gives a legacy token the same digest as the authorization it is mapped to", () => {
    const mapped = completionPaymentData({ cart_id: "cart_1", payment_provider_id: "pp_prism_prism", ucp_version: "2026-04-08", payment_data: { token: CREDENTIAL } })

    expect(paymentSessionDataFor(mapped, undefined).credential_sha256).toBe(credentialSha256(CREDENTIAL))
  })
})

describe("the settlement marker around the cart completion", () => {
  const NOW = new Date("2026-10-19T01:00:00.000Z")

  it("marks a credential payment as settling with its digest", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1" }])

    await beginSettlementAttempt({ cart_id: "cart_1", payment_data: { eip3009_authorization: CREDENTIAL }, resumed: false }, containerWith(sessions), NOW)

    expect(sessions.rows.get("cart_1")?.pending_settlement).toEqual({
      state: "settling",
      credential_sha256: credentialSha256(CREDENTIAL),
      resumed: false,
      started_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      transaction: null,
      reason: null,
      provider_called_at: null,
    })
  })

  it("marks a payment without a credential as settling with no digest", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1" }])

    await beginSettlementAttempt({ cart_id: "cart_1", resumed: false }, containerWith(sessions), NOW)

    expect(sessions.rows.get("cart_1")?.pending_settlement).toMatchObject({ state: "settling", credential_sha256: null })
  })

  it("keeps the transaction of an earlier attempt when a resume starts", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: pendingMarker({ transaction: "0xaa" }) }])

    await beginSettlementAttempt({ cart_id: "cart_1", payment_data: { eip3009_authorization: CREDENTIAL }, resumed: true }, containerWith(sessions), NOW)

    expect(sessions.rows.get("cart_1")?.pending_settlement).toMatchObject({ state: "settling", resumed: true, transaction: "0xaa" })
  })

  const compensate = async (sessionData: Record<string, unknown> | null, resumed: boolean, digest: string | null = credentialSha256(CREDENTIAL), status = "error", marker: Partial<PendingSettlementRecord> = {}) => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: pendingMarker({ state: "settling", credential_sha256: digest, transaction: "0xaa", ...marker }) }])
    const paymentSessions = [
      { id: "ps_other", provider_id: "pp_prism_prism", status: "error", data: { credential_sha256: "other", settlement_state: "settled" } },
      ...(sessionData ? [{ id: "ps_1", provider_id: "pp_prism_prism", status, data: { credential_sha256: credentialSha256(CREDENTIAL), ...sessionData } }] : []),
    ]
    const query = { graph: vi.fn(async () => ({ data: [{ id: "cart_1", payment_collection: { payment_sessions: paymentSessions } }] })) }
    await compensateSettlementAttempt({ cart_id: "cart_1", credential_sha256: digest, resumed }, containerWith(sessions, { query }), NOW)
    return sessions.rows.get("cart_1")?.pending_settlement ?? null
  }

  it.each([
    ["a settled payment that produced no order", { settlement_state: "settled", prism_tx_id: "0xtx" }, "review", "review"],
    ["a pending settle", { settlement_state: "pending" }, "pending", "pending"],
    ["a settle held for review", { settlement_state: "review" }, "review", "review"],
    ["a declined settle", { settlement_state: "declined" }, null, "review"],
    ["a failure without a matching session", null, "pending", "review"],
    ["an errored session without a settlement state", { error: "x" }, "pending", "review"],
  ])("records %s", async (_label, sessionData, first, resume) => {
    expect((await compensate(sessionData, false))?.state ?? null).toBe(first)
    expect((await compensate(sessionData, true))?.state ?? null).toBe(resume)
  })

  it("clears the marker when the completion fails before the payment reaches the provider", async () => {
    expect(await compensate({}, false, credentialSha256(CREDENTIAL), "pending")).toBeNull()
  })

  it("holds the settlement for review when the provider was called but its answer was never saved", async () => {
    const providerCalledAt = "2026-10-19T00:00:01.000Z"

    expect(await compensate({}, false, credentialSha256(CREDENTIAL), "pending", { provider_called_at: providerCalledAt })).toMatchObject({
      state: "review",
      transaction: "0xaa",
      provider_called_at: providerCalledAt,
    })
  })

  it("records the provider call on the settling marker", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: pendingMarker({ state: "settling" }) }])

    await markProviderCalled("cart_1", containerWith(sessions), NOW)

    expect(sessions.rows.get("cart_1")?.pending_settlement).toMatchObject({ state: "settling", provider_called_at: NOW.toISOString() })
  })

  it("records nothing for a cart without an agent session or without a settling marker", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1" }])

    await expect(markProviderCalled("cart_2", containerWith(sessions), NOW)).resolves.toBeUndefined()
    await markProviderCalled("cart_1", containerWith(sessions), NOW)

    expect(sessions.rows.get("cart_1")?.pending_settlement).toBeNull()
  })

  it("starts every attempt without a recorded provider call", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: pendingMarker({ provider_called_at: "2026-10-19T00:00:01.000Z" }) }])

    await beginSettlementAttempt({ cart_id: "cart_1", payment_data: { eip3009_authorization: CREDENTIAL }, resumed: true }, containerWith(sessions), NOW)

    expect(sessions.rows.get("cart_1")?.pending_settlement).toMatchObject({ state: "settling", provider_called_at: null })
  })

  it("keeps a resumed settlement pending when the completion fails before the payment reaches the provider", async () => {
    expect(await compensate({}, true, credentialSha256(CREDENTIAL), "pending")).toMatchObject({ state: "pending", transaction: "0xaa" })
  })

  it("clears the marker of a payment without a credential", async () => {
    expect(await compensate({ settlement_state: "pending" }, false, null)).toBeNull()
    expect(await compensate(null, true, null)).toBeNull()
  })

  it("keeps the stored transaction when the failed settle reports none", async () => {
    expect(await compensate({ settlement_state: "pending" }, true)).toMatchObject({ state: "pending", transaction: "0xaa" })
  })

  it("clears the marker after a paid order", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", pending_settlement: pendingMarker({ state: "settling" }) }])

    await clearSettlementAttempt({ cart_id: "cart_1" }, containerWith(sessions))

    expect(sessions.rows.get("cart_1")?.pending_settlement).toBeNull()
  })

  it("does not fail a paid order when the marker cannot be cleared", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const sessions = fakeAgentSessions([{ cart_id: "cart_1" }])
    sessions.setPendingSettlement = vi.fn(async () => { throw new Error("db down") })

    await expect(clearSettlementAttempt({ cart_id: "cart_1" }, containerWith(sessions))).resolves.toBeUndefined()
    vi.restoreAllMocks()
  })
})
