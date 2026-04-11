import {
  createWorkflow,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  updateCartWorkflow,
  refreshPaymentCollectionForCartWorkflow,
} from "@medusajs/medusa/core-flows"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"

type CancelCheckoutSessionInput = {
  cart_id: string
}

const cancelCheckoutSessionWorkflow = createWorkflow(
  "cancel-checkout-session",
  (input: CancelCheckoutSessionInput) => {
    // Step 1: Fetch current cart to check status
    const cartData = useQueryGraphStep({
      entity: "cart",
      fields: ["id", "completed_at", "metadata", "payment_collection.id"],
      filters: { id: input.cart_id },
    }).config({ name: "fetch-cart-for-cancel" })

    // Step 2: Validate and prepare update
    const updateInput = transform(
      { input, cartData },
      ({ input, cartData }) => {
        const cart = cartData.data?.[0]
        if (!cart) {
          throw new Error(`Cart ${input.cart_id} not found`)
        }
        if (cart.completed_at) {
          throw new Error("Cannot cancel a completed checkout session")
        }
        return {
          id: input.cart_id,
          metadata: {
            ...(cart.metadata || {}),
            checkout_session_canceled: true,
            canceled_at: new Date().toISOString(),
          },
        }
      }
    )

    // Step 3: Update cart metadata to mark as cancelled
    updateCartWorkflow.runAsStep({
      input: updateInput as any,
    })

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
