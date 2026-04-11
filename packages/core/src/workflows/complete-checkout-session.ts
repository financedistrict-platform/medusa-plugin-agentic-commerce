import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { validateCheckoutPrerequisitesStep } from "./steps/validate-checkout-prerequisites"
import { ensureShippingMethodStep } from "./steps/ensure-shipping-method"
import { setupPaymentStep } from "./steps/setup-payment"

type CompleteCheckoutSessionInput = {
  cart_id: string
  payment_provider_id: string
  payment_data?: {
    /** Base64-encoded x402 PaymentAuthorizationResult */
    eip3009_authorization?: string
    /** x402 protocol version */
    x402_version?: number
    /** Payment handler ID (e.g., "xyz.fd.prism_payment") */
    handler_id?: string
    /** @deprecated Legacy fields */
    provider?: string
    token?: string
    [key: string]: unknown
  }
  billing_address?: Record<string, unknown>
}

const completeCheckoutSessionWorkflow = createWorkflow(
  "complete-checkout-session",
  (input: CompleteCheckoutSessionInput) => {
    // Step 1: Validate all prerequisites
    validateCheckoutPrerequisitesStep({ cart_id: input.cart_id })

    // Step 2: Ensure shipping method is set
    ensureShippingMethodStep({ cart_id: input.cart_id })

    // Step 3: Setup payment collection + session
    const paymentData = transform(input, (input) => {
      // Pass EIP-3009 authorization or legacy token to the payment session
      const authorization = input.payment_data?.eip3009_authorization
      const legacyToken = input.payment_data?.token
      const hasPaymentData = authorization || legacyToken

      return {
        cart_id: input.cart_id,
        payment_provider_id: input.payment_provider_id,
        payment_data: hasPaymentData
          ? {
              eip3009_authorization: authorization || legacyToken,
              x402_version: input.payment_data?.x402_version,
              handler_id: input.payment_data?.handler_id,
            }
          : undefined,
      }
    })

    setupPaymentStep(paymentData)

    // Step 4: Complete the cart → creates the order
    const completionResult = completeCartWorkflow.runAsStep({
      input: transform(input, (input) => ({ id: input.cart_id })),
    })

    // Step 5: Extract order info from result
    const result = transform(
      { completionResult, input },
      ({ completionResult, input }) => ({
        cart_id: input.cart_id,
        order_id: (completionResult as any)?.id || null,
      })
    )

    return new WorkflowResponse(result)
  }
)

export default completeCheckoutSessionWorkflow
