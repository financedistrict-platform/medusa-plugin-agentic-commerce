import {
  createWorkflow,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  refreshPaymentCollectionForCartWorkflow,
  releaseLockStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { cancelAgentSessionStep } from "./steps/cancel-agent-session"
import { assertSessionMutableStep } from "./steps/assert-session-mutable"
import { CART_LOCK_TTL_SECONDS } from "./complete-checkout-session"

type CancelCheckoutSessionInput = {
  cart_id: string
}

const cancelCheckoutSessionWorkflow = createWorkflow(
  "cancel-checkout-session",
  (input: CancelCheckoutSessionInput) => {
    const cartData = useQueryGraphStep({
      entity: "cart",
      fields: ["id", "payment_collection.id"],
      filters: { id: input.cart_id },
    }).config({ name: "fetch-cart-for-cancel" })

    acquireLockStep({ key: input.cart_id, timeout: 30, ttl: CART_LOCK_TTL_SECONDS })
    assertSessionMutableStep({ cart_id: input.cart_id })
    cancelAgentSessionStep({ cart_id: input.cart_id })
    releaseLockStep({ key: input.cart_id })

    // Step 4: Clean up payment state if a payment collection exists
    const hasPaymentCollection = transform(cartData, (cartData) => {
      const cart = cartData.data?.[0]
      return !!(cart?.payment_collection?.id)
    })

    when(hasPaymentCollection, (v) => v).then(() => {
      refreshPaymentCollectionForCartWorkflow.runAsStep({
        input: transform(input, (input) => ({
          cart_id: input.cart_id,
        })),
      })
    })

    return new WorkflowResponse(
      transform(input, (input) => ({
        cart_id: input.cart_id,
        status: "canceled",
      }))
    )
  }
)

export default cancelCheckoutSessionWorkflow
