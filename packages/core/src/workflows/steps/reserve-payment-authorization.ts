import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { PAYMENT_AUTHORIZATION_USED, PAYMENT_AUTHORIZATION_USED_MESSAGE, paymentLedger } from "../../lib/payment-ledger"
import { isPrismProvider } from "../../lib/ucp-complete-guard"
import { extractSignedSummary } from "../../lib/validate-signed-amount"

type ReservePaymentAuthorizationInput = {
  cart_id: string
  payment_provider_id: string
  payment_data?: { eip3009_authorization?: string }
}

export const reservePaymentAuthorizationStep = createStep(
  "reserve-payment-authorization",
  async (input: ReservePaymentAuthorizationInput, { container }) => {
    if (!isPrismProvider(input.payment_provider_id)) {
      return new StepResponse({ cart_id: input.cart_id })
    }

    const authorization = input.payment_data?.eip3009_authorization
    const summary = authorization ? extractSignedSummary(authorization) : null
    if (!summary) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cart ${input.cart_id} cannot be paid: the payment credential could not be read`
      )
    }

    const reserved = await paymentLedger(container).reserve({
      asset: summary.asset,
      payer: summary.payer,
      nonce: summary.nonce,
      cartId: input.cart_id,
    })
    if (!reserved) {
      throw new MedusaError(MedusaError.Types.CONFLICT, PAYMENT_AUTHORIZATION_USED_MESSAGE, PAYMENT_AUTHORIZATION_USED)
    }

    return new StepResponse({ cart_id: input.cart_id })
  }
)
