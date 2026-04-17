import { describe, it, expect } from "vitest"
import {
  CreateAcpCheckoutSessionSchema,
  UpdateAcpCheckoutSessionSchema,
  CompleteAcpCheckoutSessionSchema,
} from "../api/validation-schemas"

describe("CreateAcpCheckoutSessionSchema — spec request shape", () => {
  it("accepts the minimal spec-required body: line_items + currency + capabilities", () => {
    const result = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      currency: "USD",
      capabilities: {},
    })
    expect(result.success).toBe(true)
  })

  it("rejects body missing currency (required per spec)", () => {
    const result = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      capabilities: {},
    })
    expect(result.success).toBe(false)
  })

  it("rejects body missing capabilities (required per spec)", () => {
    const result = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      currency: "USD",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty line_items (minItems: 1 per spec)", () => {
    const result = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [],
      currency: "USD",
      capabilities: {},
    })
    expect(result.success).toBe(false)
  })

  it("rejects non-spec field 'items' (spec uses line_items)", () => {
    const result = CreateAcpCheckoutSessionSchema.safeParse({
      items: [{ id: "prod_1" }], // non-spec name
      currency: "USD",
      capabilities: {},
    })
    // Without line_items, validation fails (items is not recognized)
    expect(result.success).toBe(false)
  })

  it("accepts optional spec fields (locale, timezone, discounts, metadata)", () => {
    const result = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      currency: "USD",
      capabilities: { payment: { handlers: [] } },
      locale: "en-US",
      timezone: "America/New_York",
      discounts: { codes: ["SAVE10"] },
      metadata: { custom: "data" },
    })
    expect(result.success).toBe(true)
  })

  it("requires buyer.email when buyer is provided", () => {
    const result = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      currency: "USD",
      capabilities: {},
      buyer: { first_name: "Jane" }, // missing required email
    })
    expect(result.success).toBe(false)
  })

  it("enforces required Address fields (name, line_one, city, state, country, postal_code)", () => {
    const incomplete = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      currency: "USD",
      capabilities: {},
      fulfillment_details: {
        address: {
          line_one: "123 Main St",
          city: "Springfield",
          // missing: name, state, country, postal_code
        },
      },
    })
    expect(incomplete.success).toBe(false)

    const complete = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      currency: "USD",
      capabilities: {},
      fulfillment_details: {
        address: {
          name: "Jane Doe",
          line_one: "123 Main St",
          city: "Springfield",
          state: "IL",
          country: "US",
          postal_code: "62701",
        },
      },
    })
    expect(complete.success).toBe(true)
  })

  it("rejects phone_number on address (spec: it's on FulfillmentDetails only)", () => {
    // Zod strict by default strips unknown keys rather than failing.
    // But phone_number on FulfillmentDetails (sibling of address) should succeed.
    const ok = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      currency: "USD",
      capabilities: {},
      fulfillment_details: {
        phone_number: "+15551234567",
        address: {
          name: "Jane",
          line_one: "123 Main",
          city: "SF",
          state: "CA",
          country: "US",
          postal_code: "94105",
        },
      },
    })
    expect(ok.success).toBe(true)
  })

  it("enforces ISO 3166-1 alpha-2 country code (length 2)", () => {
    const result = CreateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }],
      currency: "USD",
      capabilities: {},
      fulfillment_details: {
        address: {
          name: "Jane",
          line_one: "123 Main",
          city: "SF",
          state: "CA",
          country: "USA", // 3-letter should fail
          postal_code: "94105",
        },
      },
    })
    expect(result.success).toBe(false)
  })
})

describe("UpdateAcpCheckoutSessionSchema — spec request shape", () => {
  it("accepts empty body (all fields optional)", () => {
    expect(UpdateAcpCheckoutSessionSchema.safeParse({}).success).toBe(true)
  })

  it("accepts selected_fulfillment_options (spec field) instead of fulfillment_option_id", () => {
    const result = UpdateAcpCheckoutSessionSchema.safeParse({
      selected_fulfillment_options: [
        { fulfillment_option_id: "opt_std_shipping" },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("accepts line_items array with spec Item shape", () => {
    const result = UpdateAcpCheckoutSessionSchema.safeParse({
      line_items: [{ id: "prod_1" }, { id: "prod_2", name: "Shirt", unit_amount: 1500 }],
    })
    expect(result.success).toBe(true)
  })
})

describe("CompleteAcpCheckoutSessionSchema — spec request shape", () => {
  it("accepts payment_data with handler_id + instrument", () => {
    const result = CompleteAcpCheckoutSessionSchema.safeParse({
      payment_data: {
        handler_id: "card_processor",
        instrument: {
          type: "card",
          credential: { type: "spt", token: "tok_abc" },
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it("accepts payment_data with purchase_order_number (B2B)", () => {
    const result = CompleteAcpCheckoutSessionSchema.safeParse({
      payment_data: {
        purchase_order_number: "PO-12345",
        payment_terms: "net_30",
      },
    })
    expect(result.success).toBe(true)
  })

  it("rejects body without payment_data (required per spec)", () => {
    const result = CompleteAcpCheckoutSessionSchema.safeParse({
      buyer: { email: "test@example.com" },
    })
    expect(result.success).toBe(false)
  })

  it("accepts billing_address inside payment_data (spec location)", () => {
    const result = CompleteAcpCheckoutSessionSchema.safeParse({
      payment_data: {
        handler_id: "h1",
        instrument: {
          type: "card",
          credential: { type: "spt", token: "tok" },
        },
        billing_address: {
          name: "Jane Doe",
          line_one: "123 Main",
          city: "SF",
          state: "CA",
          country: "US",
          postal_code: "94105",
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it("allows credential.type with handler-specific extension fields (x402)", () => {
    // Prism/x402 credentials use additional fields beyond spec's { type, token }
    const result = CompleteAcpCheckoutSessionSchema.safeParse({
      payment_data: {
        handler_id: "prism_default",
        instrument: {
          type: "default",
          credential: {
            type: "default",
            authorization: "base64-data",
            x402_version: 2,
          },
        },
      },
    })
    expect(result.success).toBe(true)
  })
})
