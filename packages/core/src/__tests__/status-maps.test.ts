import { describe, it, expect } from "vitest"
import { resolveUcpStatus, resolveAcpStatus, resolveMissingRequirements } from "../lib/status-maps"

describe("resolveUcpStatus", () => {
  it("returns 'canceled' when metadata flag is set", () => {
    expect(resolveUcpStatus({ metadata: { checkout_session_canceled: true } })).toBe("canceled")
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

describe("resolveAcpStatus", () => {
  it("returns 'canceled' when metadata flag is set", () => {
    expect(resolveAcpStatus({ metadata: { checkout_session_canceled: true } })).toBe("canceled")
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
