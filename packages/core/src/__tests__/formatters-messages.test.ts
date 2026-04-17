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

describe("UCP formatter — spec-compliant messages", () => {
  it("emits error message with recoverable severity for missing shipping_address", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
    }, "https://api.test/ucp/checkout-sessions") as any

    const msg = session.messages.find((m: any) => m.code === "missing_shipping_address")
    expect(msg).toBeDefined()
    // Spec: message types are only error | warning | info
    expect(msg.type).toBe("error")
    // Spec: severity enum = recoverable | requires_buyer_input | requires_buyer_review | unrecoverable
    expect(msg.severity).toBe("recoverable")
    // Spec: path is RFC 9535 JSONPath
    expect(msg.path).toBe("$.shipping_address")
    // Spec: no content_type = defaults to plain (we don't emit it)
    expect(msg.content_type).toBeUndefined()
  })

  it("emits error for missing email with recoverable severity", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_2",
      items: [{ id: "i1", quantity: 1 }],
      shipping_address: { address_1: "123 Main St" },
    }, "https://api.test/ucp/checkout-sessions") as any

    const msg = session.messages.find((m: any) => m.code === "missing_email")
    expect(msg).toBeDefined()
    expect(msg.type).toBe("error")
    expect(msg.severity).toBe("recoverable")
    expect(msg.path).toBe("$.buyer.email")
  })

  it("emits error for empty cart with recoverable severity", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_3",
      items: [],
    }, "https://api.test/ucp/checkout-sessions") as any

    const msg = session.messages.find((m: any) => m.code === "missing_items")
    expect(msg).toBeDefined()
    expect(msg.type).toBe("error")
    expect(msg.severity).toBe("recoverable")
  })

  it("emits info message (no severity, no non-spec fields) when ready_for_complete", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_4",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
      shipping_address: { address_1: "123 Main St" },
    }, "https://api.test/ucp/checkout-sessions") as any

    expect(session.status).toBe("ready_for_complete")
    const info = session.messages.find((m: any) => m.code === "ready_for_complete")
    expect(info).toBeDefined()
    expect(info.type).toBe("info")
    // Spec message_info does not have severity
    expect(info.severity).toBeUndefined()
    // No required_action type (non-spec)
    expect(session.messages.filter((m: any) => m.type === "required_action")).toHaveLength(0)
  })

  it("all messages use only spec-allowed types (error/warning/info)", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_5",
      items: [],
    }, "https://api.test/ucp/checkout-sessions") as any

    for (const m of session.messages) {
      expect(["error", "warning", "info"]).toContain(m.type)
    }
  })

  it("emits 3 recoverable errors when all fields are missing", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_6",
      items: [],
    }, "https://api.test/ucp/checkout-sessions") as any

    const errors = session.messages.filter((m: any) => m.type === "error")
    expect(errors).toHaveLength(3)
    expect(errors.every((e: any) => e.severity === "recoverable")).toBe(true)
  })

  it("emits info with code 'checkout_completed' and no severity when completed", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_7",
      completed_at: "2026-04-17T00:00:00Z",
      items: [{ id: "i1", quantity: 1 }],
    }, "https://api.test/ucp/checkout-sessions") as any

    expect(session.status).toBe("completed")
    expect(session.messages[0].type).toBe("info")
    expect(session.messages[0].code).toBe("checkout_completed")
    expect(session.messages[0].severity).toBeUndefined()
  })
})

describe("UCP formatter — spec-compliant top-level structure", () => {
  it("includes all required fields per checkout.json", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1, unit_price: 1000 }],
      subtotal: 1000,
      total: 1000,
    }, "https://api.test/ucp/checkout-sessions") as any

    // Spec required: ucp, id, line_items, status, currency, totals, links
    expect(session.ucp).toBeDefined()
    expect(session.id).toBe("cart_1")
    expect(session.line_items).toBeDefined()
    expect(session.status).toBeDefined()
    expect(session.currency).toBeDefined()
    expect(session.totals).toBeDefined()
    expect(session.links).toBeDefined()
  })

  it("uses spec buyer fields (first_name, last_name, email, phone_number)", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
      shipping_address: {
        first_name: "Jane",
        last_name: "Doe",
        phone: "+1-555-0100",
      },
    }, "https://api.test/ucp/checkout-sessions") as any

    expect(session.buyer).toEqual({
      first_name: "Jane",
      last_name: "Doe",
      email: "buyer@example.com",
      phone_number: "+1-555-0100",
    })
    // No non-spec 'name' field
    expect(session.buyer.name).toBeUndefined()
  })

  it("uses spec postal_address fields for shipping_address", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      shipping_address: {
        address_1: "123 Main St",
        address_2: "Apt 4",
        city: "Springfield",
        province: "IL",
        postal_code: "62701",
        country_code: "US",
      },
    }, "https://api.test/ucp/checkout-sessions") as any

    expect(session.shipping_address).toEqual({
      street_address: "123 Main St",
      extended_address: "Apt 4",
      address_locality: "Springfield",
      address_region: "IL",
      postal_code: "62701",
      address_country: "US",
    })
    // No non-spec fields
    expect(session.shipping_address.line1).toBeUndefined()
    expect(session.shipping_address.line2).toBeUndefined()
    expect(session.shipping_address.city).toBeUndefined()
    expect(session.shipping_address.state).toBeUndefined()
    expect(session.shipping_address.country).toBeUndefined()
  })

  it("emits expires_at as RFC 3339 timestamp, defaulting to +6h from created_at", () => {
    const createdAt = "2026-04-17T00:00:00.000Z"
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      created_at: createdAt,
    }, "https://api.test/ucp/checkout-sessions") as any

    expect(session.expires_at).toBe("2026-04-17T06:00:00.000Z")
  })

  it("does not emit the non-spec 'fulfillment' top-level field", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      shipping_address: { address_1: "123 Main St" },
      shipping_methods: [{ id: "sm1", amount: 500, name: "Std" }],
    }, "https://api.test/ucp/checkout-sessions") as any

    expect(session.fulfillment).toBeUndefined()
  })

  it("uppercases currency code per spec (ISO 4217)", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      currency_code: "eur",
    }, "https://api.test/ucp/checkout-sessions") as any

    expect(session.currency).toBe("EUR")
  })
})

describe("UCP formatter — totals per spec", () => {
  it("always emits subtotal and total entries", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      subtotal: 1000,
      total: 1000,
    }, "https://api.test/ucp/checkout-sessions") as any

    const subtotals = session.totals.filter((t: any) => t.type === "subtotal")
    const totals = session.totals.filter((t: any) => t.type === "total")
    expect(subtotals).toHaveLength(1)
    expect(totals).toHaveLength(1)
  })

  it("emits discount amount as negative per spec", () => {
    const session = formatUcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      subtotal: 1000,
      discount_total: 200, // Medusa stores as positive
      total: 800,
    }, "https://api.test/ucp/checkout-sessions") as any

    const discount = session.totals.find((t: any) => t.type === "discount")
    expect(discount).toBeDefined()
    expect(discount.amount).toBeLessThan(0)
    expect(discount.amount).toBe(-20000) // toMinor multiplies by 100
  })
})

describe("ACP formatter messages", () => {
  it("emits error message for missing shipping address", () => {
    const session = formatAcpCheckoutSession(ctx, {
      id: "cart_1",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
    }, "https://api.test/acp/checkout_sessions") as any

    const errorMsg = session.messages.find((m: any) => m.type === "error" && m.content.includes("fulfillment address"))
    expect(errorMsg).toBeDefined()
  })

  it("transitions to ready_for_payment with items + email + address", () => {
    const session = formatAcpCheckoutSession(ctx, {
      id: "cart_2",
      items: [{ id: "i1", quantity: 1 }],
      email: "buyer@example.com",
      shipping_address: { address_1: "123 Main St" },
    }, "https://api.test/acp/checkout_sessions") as any

    expect(session.status).toBe("ready_for_payment")
  })
})
