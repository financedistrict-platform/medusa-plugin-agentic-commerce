import { describe, it, expect } from "vitest"
import {
  buildUcpFulfillment,
  extractSelectedFulfillmentOptionId,
  UCP_FULFILLMENT_METHOD_SHIPPING_ID,
  UCP_FULFILLMENT_GROUP_DEFAULT_ID,
} from "../lib/formatters/ucp-fulfillment"
import { formatUcpCheckoutSession } from "../lib/formatters/ucp"
import { UpdateUcpCheckoutSessionSchema } from "../api/validation-schemas"

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

const addressCart = {
  id: "cart_1",
  currency_code: "usd",
  items: [
    { id: "li_1", quantity: 2, unit_price: 10 },
    { id: "li_2", quantity: 1, unit_price: 5 },
  ],
  shipping_address: {
    id: "addr_1",
    first_name: "Ada",
    last_name: "Lovelace",
    address_1: "1 Analytical Way",
    city: "London",
    postal_code: "SW1A 1AA",
    country_code: "gb",
  },
  shipping_methods: [],
}

const shippingOptions = [
  { id: "so_std", name: "Standard", amount: 5, provider_id: "manual" },
  { id: "so_exp", name: "Express", amount: 15, provider_id: "fedex" },
]

describe("buildUcpFulfillment — spec shape", () => {
  it("returns undefined when cart has no items (nothing to fulfill)", () => {
    const f = buildUcpFulfillment({ items: [] }, shippingOptions)
    expect(f).toBeUndefined()
  })

  it("emits exactly one shipping method covering all line items", () => {
    const f = buildUcpFulfillment(addressCart, shippingOptions)!
    expect(f.methods).toHaveLength(1)
    const method = f.methods[0]
    // Spec fulfillment_method.json requires id, type, line_item_ids
    expect(method.id).toBe(UCP_FULFILLMENT_METHOD_SHIPPING_ID)
    expect(method.type).toBe("shipping")
    expect(method.line_item_ids).toEqual(["li_1", "li_2"])
  })

  it("includes the cart shipping_address as a shipping_destination with id", () => {
    const f = buildUcpFulfillment(addressCart, shippingOptions)!
    const method = f.methods[0]
    // Spec fulfillment_destination.json oneOf: shipping_destination REQUIRES id
    expect(method.destinations).toHaveLength(1)
    expect(method.destinations[0].id).toBe("addr_1")
    expect(method.selected_destination_id).toBe("addr_1")
    // postal_address fields present
    expect(method.destinations[0].street_address).toBe("1 Analytical Way")
    expect(method.destinations[0].address_country).toBe("gb")
  })

  it("falls back to a synthetic destination id when address has none", () => {
    const cart = {
      ...addressCart,
      shipping_address: { ...addressCart.shipping_address, id: undefined },
    }
    const f = buildUcpFulfillment(cart, shippingOptions)!
    expect(f.methods[0].destinations[0].id).toBe("cart_shipping_address")
  })

  it("produces one group with all line items and mapped options", () => {
    const f = buildUcpFulfillment(addressCart, shippingOptions)!
    const [group] = f.methods[0].groups
    // Spec fulfillment_group.json requires id, line_item_ids
    expect(group.id).toBe(UCP_FULFILLMENT_GROUP_DEFAULT_ID)
    expect(group.line_item_ids).toEqual(["li_1", "li_2"])
    expect(group.options).toHaveLength(2)
  })

  it("maps each shipping option to a spec-compliant fulfillment_option", () => {
    const f = buildUcpFulfillment(addressCart, shippingOptions)!
    const [opt] = f.methods[0].groups[0].options
    // Spec fulfillment_option.json requires id, title, totals
    expect(opt.id).toBe("so_std")
    expect(opt.title).toBe("Standard")
    expect(opt.totals).toHaveLength(1)
    // Per total.json, type "fulfillment" must have amount minimum: 0
    expect(opt.totals[0].type).toBe("fulfillment")
    expect(opt.totals[0].amount).toBe(500) // minor units
    expect(opt.totals[0].amount).toBeGreaterThanOrEqual(0)
    // Optional carrier field
    expect(opt.carrier).toBe("manual")
  })

  it("reflects currently selected shipping option as selected_option_id", () => {
    const cart = {
      ...addressCart,
      shipping_methods: [{ id: "sm_1", shipping_option_id: "so_exp" }],
    }
    const f = buildUcpFulfillment(cart, shippingOptions)!
    expect(f.methods[0].groups[0].selected_option_id).toBe("so_exp")
  })

  it("selected_option_id is null when no shipping method chosen yet", () => {
    const f = buildUcpFulfillment(addressCart, shippingOptions)!
    expect(f.methods[0].groups[0].selected_option_id).toBeNull()
  })

  it("returns empty options array when no shipping options available", () => {
    const f = buildUcpFulfillment(addressCart, [])!
    expect(f.methods[0].groups[0].options).toEqual([])
  })

  it("omits destinations when cart has no shipping address", () => {
    const cart = { ...addressCart, shipping_address: null }
    const f = buildUcpFulfillment(cart, shippingOptions)!
    expect(f.methods[0].destinations).toEqual([])
    expect(f.methods[0].selected_destination_id).toBeNull()
  })
})

describe("extractSelectedFulfillmentOptionId — spec selection path", () => {
  it("returns the selected_option_id from the first group that has one", () => {
    const id = extractSelectedFulfillmentOptionId({
      methods: [
        { id: "shipping", groups: [{ id: "default", selected_option_id: "so_exp" }] },
      ],
    })
    expect(id).toBe("so_exp")
  })

  it("returns undefined when fulfillment is missing or malformed", () => {
    expect(extractSelectedFulfillmentOptionId(undefined)).toBeUndefined()
    expect(extractSelectedFulfillmentOptionId(null)).toBeUndefined()
    expect(extractSelectedFulfillmentOptionId({})).toBeUndefined()
    expect(extractSelectedFulfillmentOptionId({ methods: [] })).toBeUndefined()
    expect(extractSelectedFulfillmentOptionId({ methods: [{ groups: [] }] })).toBeUndefined()
  })

  it("returns undefined when no group has a selected_option_id", () => {
    const id = extractSelectedFulfillmentOptionId({
      methods: [{ groups: [{ id: "default", selected_option_id: null }] }],
    })
    expect(id).toBeUndefined()
  })

  it("skips groups with null/empty selected_option_id and returns the first populated one", () => {
    const id = extractSelectedFulfillmentOptionId({
      methods: [
        { groups: [{ selected_option_id: null }] },
        { groups: [{ selected_option_id: "" }, { selected_option_id: "so_std" }] },
      ],
    })
    expect(id).toBe("so_std")
  })
})

describe("formatUcpCheckoutSession — fulfillment integration", () => {
  it("emits dev.ucp.shopping.fulfillment capability in the envelope", () => {
    const session = formatUcpCheckoutSession(ctx, addressCart, "https://api.test/ucp/checkout-sessions") as any
    expect(session.ucp.capabilities["dev.ucp.shopping.fulfillment"]).toEqual([
      { version: "2026-01-11" },
    ])
  })

  it("attaches the fulfillment object when shipping options are supplied", () => {
    const session = formatUcpCheckoutSession(
      ctx,
      addressCart,
      "https://api.test/ucp/checkout-sessions",
      shippingOptions
    ) as any
    expect(session.fulfillment).toBeDefined()
    expect(session.fulfillment.methods).toHaveLength(1)
    expect(session.fulfillment.methods[0].groups[0].options).toHaveLength(2)
  })

  it("still emits fulfillment (with empty options) when no shipping options passed", () => {
    const session = formatUcpCheckoutSession(
      ctx,
      addressCart,
      "https://api.test/ucp/checkout-sessions"
    ) as any
    // Method still emitted so agents see the destination structure.
    expect(session.fulfillment).toBeDefined()
    expect(session.fulfillment.methods[0].groups[0].options).toEqual([])
  })

  it("omits the fulfillment field when cart has no line items", () => {
    const session = formatUcpCheckoutSession(
      ctx,
      { id: "c_empty", items: [] },
      "https://api.test/ucp/checkout-sessions",
      shippingOptions
    ) as any
    expect(session.fulfillment).toBeUndefined()
  })
})

describe("UpdateUcpCheckoutSessionSchema — fulfillment selection", () => {
  it("accepts a fulfillment body with selected_option_id on a group", () => {
    const result = UpdateUcpCheckoutSessionSchema.safeParse({
      fulfillment: {
        methods: [
          {
            id: "shipping",
            type: "shipping",
            groups: [{ id: "default", selected_option_id: "so_exp" }],
          },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it("accepts a sparse fulfillment body (only the group's selected_option_id)", () => {
    const result = UpdateUcpCheckoutSessionSchema.safeParse({
      fulfillment: {
        methods: [{ groups: [{ selected_option_id: "so_std" }] }],
      },
    })
    expect(result.success).toBe(true)
  })

  it("rejects an invalid method type", () => {
    const result = UpdateUcpCheckoutSessionSchema.safeParse({
      fulfillment: {
        methods: [{ type: "teleportation" }],
      },
    })
    expect(result.success).toBe(false)
  })

  it("still accepts empty body (no fulfillment field)", () => {
    const result = UpdateUcpCheckoutSessionSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})
