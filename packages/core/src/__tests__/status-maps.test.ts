import { describe, it, expect } from "vitest"
import { resolveUcpStatus, resolveAcpStatus, resolveMissingRequirements } from "../lib/status-maps"
import { fetchSessionCart } from "../lib/agent-session"

describe("resolveUcpStatus", () => {
  it("returns 'requires_escalation' when opts flag is set", () => {
    expect(resolveUcpStatus({
      items: [{ id: "i1" }],
      email: "test@example.com",
      shipping_address: { address_1: "x" },
    }, { requiresEscalation: true })).toBe("requires_escalation")
  })

  it("returns 'complete_in_progress' when opts flag is set", () => {
    expect(resolveUcpStatus({
      items: [{ id: "i1" }],
    }, { completeInProgress: true })).toBe("complete_in_progress")
  })

  it("returns 'canceled' when the agent session is canceled", () => {
    expect(resolveUcpStatus({ agent_session: { canceled_at: "2026-04-17T00:00:00Z" } })).toBe("canceled")
  })

  it("returns 'completed' when cart is completed", () => {
    expect(resolveUcpStatus({ completed_at: "2026-04-17T00:00:00Z" })).toBe("completed")
  })

  it("returns 'ready_for_complete' when payment is authorized", () => {
    expect(resolveUcpStatus({
      payment_collection: { status: "authorized" },
    })).toBe("ready_for_complete")
  })

  it("returns 'ready_for_complete' when cart has items + email + shipping_address", () => {
    expect(resolveUcpStatus({
      items: [{ id: "i1" }],
      email: "test@example.com",
      shipping_address: { address_1: "123 Main St" },
    })).toBe("ready_for_complete")
  })

  it("returns 'ready_for_complete' even without shipping_methods (complete flow auto-adds)", () => {
    // Regression: this was previously 'incomplete' because it required shipping_methods
    expect(resolveUcpStatus({
      items: [{ id: "i1" }],
      email: "test@example.com",
      shipping_address: { address_1: "123 Main St" },
      shipping_methods: [],
    })).toBe("ready_for_complete")
  })

  it("returns 'incomplete' when shipping_address is missing", () => {
    expect(resolveUcpStatus({
      items: [{ id: "i1" }],
      email: "test@example.com",
    })).toBe("incomplete")
  })

  it("returns 'incomplete' when email is missing", () => {
    expect(resolveUcpStatus({
      items: [{ id: "i1" }],
      shipping_address: { address_1: "123 Main St" },
    })).toBe("incomplete")
  })

  it("returns 'incomplete' for empty cart", () => {
    expect(resolveUcpStatus({})).toBe("incomplete")
  })
})

describe("resolveAcpStatus — all spec status values", () => {
  it("returns 'expired' when opts flag is set", () => {
    expect(resolveAcpStatus({}, { expired: true })).toBe("expired")
  })

  it("returns 'complete_in_progress' when opts flag is set", () => {
    expect(resolveAcpStatus({ items: [{ id: "i1" }] }, { completeInProgress: true })).toBe("complete_in_progress")
  })

  it("returns 'pending_approval' when opts flag is set", () => {
    expect(resolveAcpStatus({ items: [{ id: "i1" }] }, { pendingApproval: true })).toBe("pending_approval")
  })

  it("returns 'authentication_required' when opts flag is set", () => {
    expect(resolveAcpStatus({ items: [{ id: "i1" }] }, { authenticationRequired: true })).toBe("authentication_required")
  })

  it("returns 'requires_escalation' when opts flag is set", () => {
    expect(resolveAcpStatus({ items: [{ id: "i1" }] }, { requiresEscalation: true })).toBe("requires_escalation")
  })

  it("returns 'in_progress' when opts flag is set", () => {
    expect(resolveAcpStatus({ items: [{ id: "i1" }] }, { inProgress: true })).toBe("in_progress")
  })
})

describe("resolveAcpStatus — default resolution", () => {
  it("returns 'canceled' when the agent session is canceled", () => {
    expect(resolveAcpStatus({ agent_session: { canceled_at: "2026-04-17T00:00:00Z" } })).toBe("canceled")
  })

  it("returns 'completed' when cart is completed", () => {
    expect(resolveAcpStatus({ completed_at: "2026-04-17T00:00:00Z" })).toBe("completed")
  })

  it("returns 'ready_for_payment' when cart has items + email + shipping_address", () => {
    expect(resolveAcpStatus({
      items: [{ id: "i1" }],
      email: "test@example.com",
      shipping_address: { address_1: "123 Main St" },
    })).toBe("ready_for_payment")
  })

  it("returns 'not_ready_for_payment' when cart has items but missing address", () => {
    expect(resolveAcpStatus({
      items: [{ id: "i1" }],
    })).toBe("not_ready_for_payment")
  })

  it("returns 'incomplete' for empty cart", () => {
    expect(resolveAcpStatus({})).toBe("incomplete")
  })
})

describe("resolveMissingRequirements", () => {
  it("lists all requirements missing from an empty cart", () => {
    expect(resolveMissingRequirements({})).toEqual(["items", "email", "shipping_address"])
  })

  it("returns empty array when all requirements are met", () => {
    expect(resolveMissingRequirements({
      items: [{ id: "i1" }],
      email: "test@example.com",
      shipping_address: { address_1: "123 Main St" },
    })).toEqual([])
  })

  it("lists only shipping_address when items + email are present", () => {
    expect(resolveMissingRequirements({
      items: [{ id: "i1" }],
      email: "test@example.com",
    })).toEqual(["shipping_address"])
  })

  it("lists only email when items + address are present", () => {
    expect(resolveMissingRequirements({
      items: [{ id: "i1" }],
      shipping_address: { address_1: "123 Main St" },
    })).toEqual(["email"])
  })
})

describe("status of a checkout with an open settlement", () => {
  const ready = { items: [{ id: "i1" }], email: "a@b.c", shipping_address: { address_1: "x" } }
  const withMarker = (state: string, extra: Record<string, unknown> = {}) => ({ ...ready, ...extra, agent_session: { canceled_at: null, pending_settlement: { state } } })

  it.each([["settling"], ["pending"]])("is complete_in_progress while the settlement is %s", (state) => {
    expect(resolveUcpStatus(withMarker(state))).toBe("complete_in_progress")
    expect(resolveAcpStatus(withMarker(state))).toBe("complete_in_progress")
  })

  it("is requires_escalation while the settlement is held for review", () => {
    expect(resolveUcpStatus(withMarker("review"))).toBe("requires_escalation")
    expect(resolveAcpStatus(withMarker("review"))).toBe("requires_escalation")
  })

  it("stays completed when a marker is left after a paid order", () => {
    expect(resolveUcpStatus(withMarker("settling", { completed_at: "2026-10-19T00:00:00Z" }))).toBe("completed")
    expect(resolveAcpStatus(withMarker("review", { completed_at: "2026-10-19T00:00:00Z" }))).toBe("completed")
  })

  it("stays canceled when the session was canceled", () => {
    const canceled = { ...ready, agent_session: { canceled_at: "2026-10-19T00:00:00Z", pending_settlement: { state: "pending" } } }
    expect(resolveUcpStatus(canceled)).toBe("canceled")
  })

  it("loads the settlement marker with the cart of a session", async () => {
    const pending = { state: "pending", credential_sha256: "d1", resumed: false, started_at: "t", updated_at: "t" }
    const scope = {
      resolve: (name: string) => name === "query"
        ? { graph: async () => ({ data: [{ id: "cart_1" }] }) }
        : { find: async () => ({ cart_id: "cart_1", canceled_at: null, pending_settlement: pending }) },
    }

    const cart = await fetchSessionCart(scope, "cart_1")

    expect(cart?.agent_session?.pending_settlement).toEqual(pending)
  })
})
