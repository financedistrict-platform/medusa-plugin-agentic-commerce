import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createPaymentSessionsWorkflow,
  deletePaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { checkoutTotalMismatch, PRISM_CHECKOUT_DATA_KEY } from "../../lib/checkout-total-binding"
import { agentSessions, handlerDataOf, isCanceled } from "../../lib/agent-session"
import { PRISM_UCP_HANDLER_ID } from "../../lib/ucp-complete-guard"

type SetupPaymentInput = {
  cart_id: string
  payment_provider_id: string
  ucp_version: string
  payment_data?: {
    credential_sha256?: string
    x402_version?: number
    handler_id?: string
    instrument_type?: string
  }
}

export function paymentSessionDataFor(
  input: Pick<SetupPaymentInput, "ucp_version" | "payment_data">,
  storedQuote: unknown,
): Record<string, unknown> {
  const sessionData: Record<string, unknown> = { ucp_version: input.ucp_version }
  const payment = input.payment_data

  if (payment?.credential_sha256) {
    sessionData.credential_sha256 = payment.credential_sha256
    if (payment.x402_version) {
      sessionData.x402_version = payment.x402_version
    }
    if (payment.instrument_type) {
      sessionData.instrument_type = payment.instrument_type
    }
  }

  if (storedQuote) {
    sessionData[PRISM_CHECKOUT_DATA_KEY] = storedQuote
  }

  return sessionData
}

export type ExistingPaymentSession = {
  id: string
  status?: string
  provider_id?: string
  data?: Record<string, unknown> | null
}

export function isSettledWithSameCredential(
  session: ExistingPaymentSession,
  input: Pick<SetupPaymentInput, "payment_provider_id" | "payment_data">,
): boolean {
  const digest = input.payment_data?.credential_sha256
  return (
    session.status === "authorized" &&
    session.provider_id === input.payment_provider_id &&
    typeof digest === "string" &&
    digest.length > 0 &&
    session.data?.credential_sha256 === digest &&
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

    const session = await agentSessions(container).find(input.cart_id)
    if (!session || isCanceled(session)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cart ${input.cart_id} cannot be paid: checkout session is ${session ? "canceled" : "not found"}`
      )
    }
    const storedQuote = handlerDataOf(session)[PRISM_UCP_HANDLER_ID]

    const mismatch = checkoutTotalMismatch({
      paymentProviderId: input.payment_provider_id,
      cartTotal: cart?.total,
      cartCurrency: cart?.currency_code,
      paymentCollectionAmount: cart?.payment_collection?.amount,
      storedQuote,
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
          data: paymentSessionDataFor(input, storedQuote),
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
