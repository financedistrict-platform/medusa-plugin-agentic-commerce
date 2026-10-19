import { describe, it, expect } from "vitest"
import { CART_LOCK_TTL_SECONDS } from "@financedistrict/medusa-plugin-agentic-commerce"
import { SETTLE_TIMEOUT_MS } from "../lib/prism-client"

describe("settle timeout and cart lock", () => {
  it("leaves at least 60 seconds of the cart lock after the settle call gives up", () => {
    expect(SETTLE_TIMEOUT_MS + 60_000).toBeLessThanOrEqual(CART_LOCK_TTL_SECONDS * 1000)
  })
})
