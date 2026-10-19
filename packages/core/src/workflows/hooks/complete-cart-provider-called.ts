import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { markProviderCalled } from "../steps/mark-provider-called"

type ProviderCalledHandler = (payload: { input: { id: string } }, context: { container: { resolve: (name: string) => unknown } }) => Promise<void>

const hooks = completeCartWorkflow.hooks as unknown as { beforePaymentAuthorization?: (handler: ProviderCalledHandler) => void }

if (typeof hooks.beforePaymentAuthorization !== "function") {
  throw new Error("completeCartWorkflow no longer exposes the beforePaymentAuthorization hook; agent settlements cannot record the provider call")
}

hooks.beforePaymentAuthorization(async ({ input }, { container }) => {
  await markProviderCalled(input.id, container)
})
