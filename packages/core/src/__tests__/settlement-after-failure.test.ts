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

describe("credential digest", () => {
  it("is the sha256 hex of the credential as received", () => {
    expect(credentialSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
})

describe("settlement state after a failed completion", () => {
  it.each([
    ["a payment without a credential", null, marker({ credential_sha256: null }), "clear", "clear"],
    ["money moved but no order", { settlement_state: "settled", prism_tx_id: "0xtx" }, marker(), "review", "review"],
    ["a pending settle", { settlement_state: "pending" }, marker(), "pending", "pending"],
    ["a settle held for review", { settlement_state: "review" }, marker(), "review", "review"],
    ["a declined settle", { settlement_state: "declined" }, marker(), "clear", "review"],
    ["no matching payment session", null, marker(), "pending", "review"],
    ["a session without a settlement state", { error: "x" }, marker(), "pending", "review"],
  ])("records %s", (_label, sessionData, stored, first, resume) => {
    expect(settlementAfterFailure(sessionData, stored, false).kind).toBe(first)
    expect(settlementAfterFailure(sessionData, stored, true).kind).toBe(resume)
  })

  it("keeps the transaction the settle reported", () => {
    const result = settlementAfterFailure({ settlement_state: "pending", unreconciled_transaction: "0xbb" }, marker({ transaction: "0xaa" }), false)

    expect(result).toEqual({ kind: "pending", transaction: "0xbb" })
  })

  it("keeps the stored transaction when a resumed settle reports none", () => {
    const result = settlementAfterFailure({ settlement_state: "pending" }, marker({ transaction: "0xaa" }), true)

    expect(result).toEqual({ kind: "pending", transaction: "0xaa" })
  })

  it("keeps the transaction of a settled payment that produced no order", () => {
    expect(settlementAfterFailure({ settlement_state: "settled", prism_tx_id: "0xcc" }, marker(), false)).toEqual({ kind: "review", transaction: "0xcc" })
  })

  it("carries no transaction when a first attempt is cleared", () => {
    expect(settlementAfterFailure({ settlement_state: "declined" }, marker({ transaction: "0xaa" }), false)).toEqual({ kind: "clear" })
  })
})
