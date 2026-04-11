import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"

type SetupPaymentInput = {
  cart_id: string
  payment_provider_id: string
  payment_data?: {
    /** Base64-encoded x402 PaymentAuthorizationResult */
    eip3009_authorization?: string
    /** x402 protocol version */
    x402_version?: number
    /** Payment handler ID */
    handler_id?: string
    /** @deprecated Legacy token field */
    token?: string
    [key: string]: unknown
  }
}

export const setupPaymentStep = createStep(
  "setup-payment",
  async (input: SetupPaymentInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Check if cart already has a payment collection
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "payment_collection.id",
        "payment_collection.payment_sessions.*",
      ],
      filters: { id: input.cart_id },
    })

    let paymentCollectionId = cart?.payment_collection?.id

    // Create payment collection if none exists
    if (!paymentCollectionId) {
      await createPaymentCollectionForCartWorkflow(container).run({
        input: { cart_id: input.cart_id },
      })

      // Re-fetch to get the payment collection ID
      const { data: [updatedCart] } = await query.graph({
        entity: "cart",
        fields: ["id", "payment_collection.id"],
        filters: { id: input.cart_id },
      })

      paymentCollectionId = updatedCart?.payment_collection?.id

      if (!paymentCollectionId) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Failed to create payment collection for cart"
        )
      }
    }

    // Check if there's already an active payment session
    const existingSessions = cart?.payment_collection?.payment_sessions || []
    const hasActiveSession = existingSessions.some(
      (s: any) => s.status === "pending" || s.status === "authorized"
    )

    if (!hasActiveSession) {
      // Create payment session with the configured provider
      const sessionData: Record<string, unknown> = {}

      // Pass EIP-3009 authorization to the payment provider
      // The provider receives this in its initiatePayment() and stores it in session data,
      // then receives it again in authorizePayment() during cart completion
      if (input.payment_data?.eip3009_authorization) {
        sessionData.eip3009_authorization = input.payment_data.eip3009_authorization
        if (input.payment_data.x402_version) {
          sessionData.x402_version = input.payment_data.x402_version
        }
      }

      // Legacy: pass flat token for backwards compatibility
      if (input.payment_data?.token && !input.payment_data?.eip3009_authorization) {
        sessionData.shared_payment_token = input.payment_data.token
      }

      await createPaymentSessionsWorkflow(container).run({
        input: {
          payment_collection_id: paymentCollectionId,
          provider_id: input.payment_provider_id,
          data: sessionData,
          context: {},
        },
      })
    }

    return new StepResponse(
      {
        cart_id: input.cart_id,
        payment_collection_id: paymentCollectionId,
      },
      // Compensation data — used for cleanup on workflow failure
      {
        cart_id: input.cart_id,
        payment_collection_id: paymentCollectionId,
      }
    )
  },
  // Compensation: refresh payment collection on failure
  async (compensationData, { container }) => {
    if (!compensationData?.cart_id) return

    try {
      const { refreshPaymentCollectionForCartWorkflow } = await import(
        "@medusajs/medusa/core-flows"
      )
      await refreshPaymentCollectionForCartWorkflow(container).run({
        input: { cart_id: compensationData.cart_id },
      })
    } catch {
      // Best effort cleanup — don't throw from compensation
    }
  }
)
