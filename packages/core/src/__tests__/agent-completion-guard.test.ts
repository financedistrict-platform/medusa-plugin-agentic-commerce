import { describe, it, expect } from "vitest"
import { assertAgentCompletion, AGENT_CHECKOUT_REQUIRED } from "../lib/agent-completion-guard"
import { CART_LOCK_TTL_SECONDS } from "../workflows/complete-checkout-session"
import type { PendingSettlementRecord } from "../lib/agent-session"
import { sessionRecord } from "./helpers/agent-session-store"

const NOW = new Date("2026-10-19T12:00:00.000Z")

const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString()

const marker = (state: PendingSettlementRecord["state"], startedAt = secondsAgo(1)): PendingSettlementRecord => ({
  state,
  credential_sha256: "d1",
  resumed: false,
  started_at: startedAt,
  updated_at: startedAt,
})

const session = (pending: PendingSettlementRecord | null, canceledAt: string | null = null) =>
  sessionRecord({ cart_id: "cart_1", pending_settlement: pending, canceled_at: canceledAt })

function refusal(run: () => void): { code?: unknown } | undefined {
  try {
    run()
  } catch (error: unknown) {
    return error as { code?: unknown }
  }
  return undefined
}

describe("completing a cart outside the agent checkout", () => {
  it("lets a cart without an agent session complete", () => {
    expect(() => assertAgentCompletion(null, NOW)).not.toThrow()
  })

  it("refuses a canceled agent session", () => {
    expect(refusal(() => assertAgentCompletion(session(marker("settling"), secondsAgo(5)), NOW))?.code).toBe(AGENT_CHECKOUT_REQUIRED)
  })

  it("refuses an agent cart that the agent checkout is not completing", () => {
    expect(refusal(() => assertAgentCompletion(session(null), NOW))?.code).toBe(AGENT_CHECKOUT_REQUIRED)
  })

  it.each([["pending"], ["review"]] as const)("refuses an agent cart whose settlement is %s", (state) => {
    expect(refusal(() => assertAgentCompletion(session(marker(state)), NOW))?.code).toBe(AGENT_CHECKOUT_REQUIRED)
  })

  it("refuses a settling marker older than the cart lock", () => {
    expect(refusal(() => assertAgentCompletion(session(marker("settling", secondsAgo(CART_LOCK_TTL_SECONDS + 1))), NOW))?.code).toBe(AGENT_CHECKOUT_REQUIRED)
  })

  it("refuses a settling marker with an unreadable start time", () => {
    expect(refusal(() => assertAgentCompletion(session(marker("settling", "not a date")), NOW))?.code).toBe(AGENT_CHECKOUT_REQUIRED)
  })

  it("lets the agent checkout complete the cart while its settling marker is fresh", () => {
    expect(() => assertAgentCompletion(session(marker("settling", secondsAgo(CART_LOCK_TTL_SECONDS - 1))), NOW)).not.toThrow()
  })
})
