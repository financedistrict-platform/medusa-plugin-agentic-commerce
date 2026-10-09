import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createPaymentSessionsWorkflow,
  deletePaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { checkoutTotalMismatch, PRISM_CHECKOUT_DATA_KEY } from "../../lib/checkout-total-binding"

type SetupPaymentInput = {
  cart_id: string
  payment_provider_id: string
  ucp_version: string
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

export function paymentSessionDataFor(
  input: Pick<SetupPaymentInput, "ucp_version" | "payment_data">,
  cartMetadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sessionData: Record<string, unknown> = { ucp_version: input.ucp_version }

  if (input.payment_data?.eip3009_authorization) {
    sessionData.eip3009_authorization = input.payment_data.eip3009_authorization
    if (input.payment_data.x402_version) {
      sessionData.x402_version = input.payment_data.x402_version
    }
    if (input.payment_data.instrument_type) {
      sessionData.instrument_type = input.payment_data.instrument_type
    }
  }

  if (input.payment_data?.token && !input.payment_data?.eip3009_authorization) {
    sessionData.shared_payment_token = input.payment_data.token
  }

  const storedQuote = cartMetadata?.[PRISM_CHECKOUT_DATA_KEY]
  if (storedQuote) {
    sessionData[PRISM_CHECKOUT_DATA_KEY] = storedQuote
  }

  return sessionData
}

type ExistingPaymentSession = {
  id: string
  status?: string
  provider_id?: string
  data?: Record<string, unknown> | null
}

function isSettledWithSameCredential(
  session: ExistingPaymentSession,
  input: Pick<SetupPaymentInput, "payment_provider_id" | "payment_data">,
): boolean {
  const credential = input.payment_data?.eip3009_authorization
  return (
    session.status === "authorized" &&
    session.provider_id === input.payment_provider_id &&
    typeof credential === "string" &&
    credential.length > 0 &&
    session.data?.eip3009_authorization === credential &&
    typeof session.data?.prism_tx_id === "string" &&
    session.data.prism_tx_id.length > 0
  )
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
        "total",
        "currency_code",
        "metadata",
        "payment_collection.id",
        "payment_collection.amount",
        "payment_collection.payment_sessions.*",
      ],
      filters: { id: input.cart_id },
    })

    const paymentCollectionId = cart?.payment_collection?.id
    if (!paymentCollectionId) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cart ${input.cart_id} has no payment collection to pay`
      )
    }

    const mismatch = checkoutTotalMismatch({
      paymentProviderId: input.payment_provider_id,
      cartTotal: cart?.total,
      cartCurrency: cart?.currency_code,
      paymentCollectionAmount: cart?.payment_collection?.amount,
      cartMetadata: cart?.metadata,
    })
    if (mismatch) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cart ${input.cart_id} cannot be paid: ${mismatch}. Update the checkout session to get a fresh payment quote and sign it again.`
      )
    }

    const sessions: ExistingPaymentSession[] = (cart?.payment_collection?.payment_sessions || [])
      .filter((session: ExistingPaymentSession | null): session is ExistingPaymentSession => !!session?.id)
    const settled = sessions.find((session) => isSettledWithSameCredential(session, input))
    const staleSessionIds = sessions
      .filter((session) => session !== settled)
      .map((session) => session.id)

    if (staleSessionIds.length) {
      await deletePaymentSessionsWorkflow(container).run({
        input: { ids: staleSessionIds },
      })
    }

    if (!settled) {
      await createPaymentSessionsWorkflow(container).run({
        input: {
          payment_collection_id: paymentCollectionId,
          provider_id: input.payment_provider_id,
          data: paymentSessionDataFor(input, cart?.metadata),
          context: {},
        },
      })
    }

    return new StepResponse({
      cart_id: input.cart_id,
      payment_collection_id: paymentCollectionId,
    })
  }
)
