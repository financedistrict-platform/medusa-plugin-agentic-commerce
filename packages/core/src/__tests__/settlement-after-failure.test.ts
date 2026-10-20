import { describe, it, expect } from "vitest"
import { credentialSha256 } from "../lib/credential-digest"
import { settlementAfterFailure } from "../lib/settlement-after-failure"
import type { PendingSettlementRecord } from "../lib/agent-session"

const marker = (overrides: Partial<PendingSettlementRecord> = {}): PendingSettlementRecord => ({
  state: "settling",
  credential_sha256: "d1",
  resumed: false,
  started_at: "2026-10-19T00:00:00.000Z",
  updated_at: "2026-10-19T00:00:00.000Z",
  ...overrides,
})

const failed = (data: Record<string, unknown>) => ({ status: "error", data })

const CALLED = "2026-10-19T00:00:01.000Z"

describe("credential digest", () => {
  it("is the sha256 hex of the credential as received", () => {
    expect(credentialSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
})

describe("settlement state after a failed completion", () => {
  it.each([
    ["a payment without a credential", null, marker({ credential_sha256: null }), "clear", "clear"],
    ["money moved but no order", failed({ settlement_state: "settled", prism_tx_id: "0xtx" }), marker(), "review", "review"],
    ["a pending settle", failed({ settlement_state: "pending" }), marker(), "pending", "pending"],
    ["a settle held for review", failed({ settlement_state: "review" }), marker(), "review", "review"],
    ["a declined settle", failed({ settlement_state: "declined" }), marker(), "clear", "review"],
    ["no matching payment session", null, marker(), "pending", "review"],
    ["an errored session without a settlement state", failed({ error: "x" }), marker(), "pending", "review"],
    ["a failure before the payment was sent to the provider", { status: "pending", data: { credential_sha256: "d1" } }, marker(), "clear", "pending"],
    ["a failure after the provider was called but before its answer was saved", { status: "pending", data: { credential_sha256: "d1" } }, marker({ provider_called_at: CALLED }), "review", "review"],
    ["a provider call without a matching payment session", null, marker({ provider_called_at: CALLED }), "review", "review"],
    ["an errored session without a settlement state after the provider was called", failed({ error: "x" }), marker({ provider_called_at: CALLED }), "review", "review"],
    ["a declined settle after the provider was called", failed({ settlement_state: "declined" }), marker({ provider_called_at: CALLED }), "clear", "review"],
  ])("records %s", (_label, session, stored, first, resume) => {
    expect(settlementAfterFailure(session, stored, false).kind).toBe(first)
    expect(settlementAfterFailure(session, stored, true).kind).toBe(resume)
  })

  it("keeps the transaction the settle reported", () => {
    const result = settlementAfterFailure(failed({ settlement_state: "pending", unreconciled_transaction: "0xbb" }), marker({ transaction: "0xaa" }), false)

    expect(result).toEqual({ kind: "pending", transaction: "0xbb" })
  })

  it("keeps the stored transaction when a resumed settle reports none", () => {
    const result = settlementAfterFailure(failed({ settlement_state: "pending" }), marker({ transaction: "0xaa" }), true)

    expect(result).toEqual({ kind: "pending", transaction: "0xaa" })
  })

  it("keeps the transaction of a settled payment that produced no order", () => {
    expect(settlementAfterFailure(failed({ settlement_state: "settled", prism_tx_id: "0xcc" }), marker(), false)).toEqual({ kind: "review", transaction: "0xcc" })
  })

  it("carries no transaction when a first attempt is cleared", () => {
    expect(settlementAfterFailure(failed({ settlement_state: "declined" }), marker({ transaction: "0xaa" }), false)).toEqual({ kind: "clear" })
  })

  it("holds a settlement for review with its known transaction when the provider answer was never saved", () => {
    expect(settlementAfterFailure({ status: "pending", data: {} }, marker({ provider_called_at: CALLED, transaction: "0xaa" }), false)).toEqual({
      kind: "review",
      transaction: "0xaa",
      reason: "provider_called_outcome_unsaved",
    })
  })

  it("keeps the earlier pending state and transaction when a resume fails before the provider is called", () => {
    expect(settlementAfterFailure({ status: "pending", data: {} }, marker({ transaction: "0xaa" }), true)).toEqual({ kind: "pending", transaction: "0xaa" })
  })
})
