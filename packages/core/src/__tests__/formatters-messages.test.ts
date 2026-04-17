import { describe, it, expect } from "vitest"
import { formatUcpCheckoutSession } from "../lib/formatters/ucp"
import { formatAcpCheckoutSession } from "../lib/formatters/acp"

const ctx = {
  storeName: "Test Store",
  storefrontUrl: "https://store.test",
  ucpVersion: "2026-01-11",
  acpVersion: "2026-01-30",
  paymentHandlers: {
    getUcpCheckoutHandlers: () => ({}),
    getAcpCheckoutHandlers: () => [],
  },
} as any

describe("UCP formatter messages", () => {
  it("emits required_action for missing shipping_address", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
      // no shipping_address
    }, "https://api.test/ucp/checkout-sessions")

    const action = session.messages.find((m: any) => m.code === "missing_shipping_address")
    expect(action).toBeDefined()
    expect(action?.type).toBe("required_action")
    expect(action?.severity).toBe("error")
    expect(session.status).toBe("incomplete")
  })

  it("emits required_action for missing email", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_2",
      items: [{ id: "i1", quantity: 1 }],
      shipping_address: { address_1: "123 Main St" },
    }, "https://api.test/ucp/checkout-sessions")

    const action = session.messages.find((m: any) => m.code === "missing_email")
    expect(action).toBeDefined()
    expect(action?.type).toBe("required_action")
  })

  it("emits required_action for empty cart (missing items)", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_3",
      items: [],
    }, "https://api.test/ucp/checkout-sessions")

    const action = session.messages.find((m: any) => m.code === "missing_items")
    expect(action).toBeDefined()
  })

  it("emits 'ready_for_complete' info message when all requirements met", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_4",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
      shipping_address: { address_1: "123 Main St" },
    }, "https://api.test/ucp/checkout-sessions")

    expect(session.status).toBe("ready_for_complete")
    const info = session.messages.find((m: any) => m.code === "ready_for_complete")
    expect(info).toBeDefined()
    expect(info?.type).toBe("info")
    // No required_action messages
    expect(session.messages.filter((m: any) => m.type === "required_action")).toHaveLength(0)
  })

  it("emits multiple required_actions when multiple fields are missing", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_5",
      items: [],
    }, "https://api.test/ucp/checkout-sessions")

    const actions = session.messages.filter((m: any) => m.type === "required_action")
    expect(actions.length).toBe(3) // items, email, shipping_address
    expect(actions.map((a: any) => a.code).sort()).toEqual([
      "missing_email",
      "missing_items",
      "missing_shipping_address",
    ])
  })

  it("emits 'checkout_completed' info when status is completed", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_6",
      completed_at: "2026-04-17T00:00:00Z",
      items: [{ id: "i1", quantity: 1 }],
    }, "https://api.test/ucp/checkout-sessions")

    expect(session.status).toBe("completed")
    expect(session.messages[0]?.code).toBe("checkout_completed")
  })
})

describe("ACP formatter messages", () => {
  it("emits error message for missing shipping address", () => {
    const session = formatAcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
    }, "https://api.test/acp/checkout_sessions")

    const errorMsg = session.messages.find((m: any) => m.type === "error" && m.content.includes("fulfillment address"))
    expect(errorMsg).toBeDefined()
  })

  it("transitions to ready_for_payment with items + email + address", () => {
    const session = formatAcpCheckoutSession(ctx, {
      id: "cart_2",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
      shipping_address: { address_1: "123 Main St" },
    }, "https://api.test/acp/checkout_sessions")

    expect(session.status).toBe("ready_for_payment")
  })
})
