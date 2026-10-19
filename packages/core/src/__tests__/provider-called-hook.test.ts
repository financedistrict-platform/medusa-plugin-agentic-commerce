import { describe, it, expect } from "vitest"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import "../workflows/hooks/complete-cart-provider-called"

describe("provider call record on the cart completion", () => {
  it("is registered as the beforePaymentAuthorization handler of completeCartWorkflow", () => {
    const hooks = completeCartWorkflow.hooks as unknown as { beforePaymentAuthorization: (handler: () => Promise<void>) => void }

    expect(() => hooks.beforePaymentAuthorization(async () => undefined)).toThrow(/multiple hook handlers/)
  })
})
