import { describe, it, expect } from "vitest"
import {
  CreateAcpCheckoutSessionSchema,
  CreateUcpCartSchema,
  CreateUcpCheckoutSessionSchema,
} from "../api/validation-schemas"

const ucpLineItems = [{ item: { id: "variant_1" }, quantity: 1 }]

describe("agent currency input reaches Medusa in lower case", () => {
  it("UCP checkout create lowercases context.currency", () => {
    const parsed = CreateUcpCheckoutSessionSchema.parse({
      line_items: ucpLineItems,
      context: { currency: "USD" },
    })
    expect(parsed.context?.currency).toBe("usd")
  })

  it("UCP cart create lowercases context.currency", () => {
    const parsed = CreateUcpCartSchema.parse({
      line_items: ucpLineItems,
      context: { currency: " Usd " },
    })
    expect(parsed.context?.currency).toBe("usd")
  })

  it("ACP checkout create lowercases currency", () => {
    const parsed = CreateAcpCheckoutSessionSchema.parse({
      line_items: [{ id: "variant_1", quantity: 1 }],
      currency: "USD",
      capabilities: {},
    })
    expect(parsed.currency).toBe("usd")
  })

  it("keeps an absent UCP currency absent", () => {
    const parsed = CreateUcpCheckoutSessionSchema.parse({ line_items: ucpLineItems, context: {} })
    expect(parsed.context?.currency).toBeUndefined()
  })
})
