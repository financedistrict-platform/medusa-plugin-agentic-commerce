import {
  createWorkflow,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  completeCartWorkflow,
  capturePaymentWorkflow,
  releaseLockStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { validateCheckoutPrerequisitesStep } from "./steps/validate-checkout-prerequisites"
import { ensureShippingMethodStep } from "./steps/ensure-shipping-method"
import { ensurePaymentCollectionStep } from "./steps/ensure-payment-collection"
import { setupPaymentStep } from "./steps/setup-payment"
import { reservePaymentAuthorizationStep } from "./steps/reserve-payment-authorization"
import { paymentToCapture } from "../lib/payment-to-capture"

type CompleteCheckoutSessionInput = {
  cart_id: string
  payment_provider_id: string
  ucp_version: string
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

    ensurePaymentCollectionStep({ cart_id: input.cart_id })

    acquireLockStep({ key: input.cart_id, timeout: 30, ttl: 120 })

    // Step 3: Setup payment collection + session
    const paymentData = transform(input, (input) => {
      // Pass EIP-3009 authorization or legacy token to the payment session
      const authorization = input.payment_data?.eip3009_authorization
      const legacyToken = input.payment_data?.token
      const hasPaymentData = authorization || legacyToken

      return {
        cart_id: input.cart_id,
        payment_provider_id: input.payment_provider_id,
        ucp_version: input.ucp_version,
        payment_data: hasPaymentData
          ? {
              eip3009_authorization: authorization || legacyToken,
              x402_version: input.payment_data?.x402_version,
              handler_id: input.payment_data?.handler_id,
              instrument_type: input.payment_data?.instrument_type,
            }
          : undefined,
      }
    })

    reservePaymentAuthorizationStep(paymentData)

    setupPaymentStep(paymentData)

    // Step 4: Complete the cart → creates the order
    const completionResult = completeCartWorkflow.runAsStep({
      input: transform(input, (input) => ({ id: input.cart_id })),
    })

    // Step 5: Capture the payment.
    //
    // `completeCartWorkflow` only authorizes — it creates a `payment` record
    // but doesn't move the order's payment_status to "captured", so the admin
    // shows "not paid" until capture runs. For x402/Prism payments the money
    // has already moved on-chain during authorize (auto_capture), so we
    // immediately capture here to reconcile Medusa's payment state with the
    // real on-chain settlement.
    const paymentQuery = useQueryGraphStep({
      entity: "cart",
      fields: [
        "id",
        "payment_collection.payments.id",
        "payment_collection.payments.provider_id",
        "payment_collection.payments.captured_at",
        "payment_collection.payments.canceled_at",
      ],
      filters: { id: input.cart_id },
    }).config({ name: "fetch-payment-id-for-capture" })

    const paymentId = transform({ paymentQuery, input }, ({ paymentQuery, input }) =>
      paymentToCapture(paymentQuery as Parameters<typeof paymentToCapture>[0], input.payment_provider_id)
    )

    when({ paymentId }, ({ paymentId }) => !!paymentId).then(() => {
      capturePaymentWorkflow.runAsStep({
        input: transform(paymentId, (id) => ({ payment_id: id as string })),
      })
    })

    releaseLockStep({ key: input.cart_id })

    // Step 6: Extract order info from result.
    // completeCartWorkflow returns { id: order.id } per Medusa core-flows, but
    // wrap defensively against shape changes across Medusa versions — check a
    // few likely locations before giving up. The route handler has a further
    // fallback via the cart→order link.
    const result = transform(
      { completionResult, input },
      ({ completionResult, input }) => {
        const cr = completionResult as any
        const orderId: string | null =
          cr?.id ||
          cr?.order_id ||
          cr?.order?.id ||
          null
        return {
          cart_id: input.cart_id,
          order_id: orderId,
        }
      }
    )

    return new WorkflowResponse(result)
  }
)

export default completeCheckoutSessionWorkflow
