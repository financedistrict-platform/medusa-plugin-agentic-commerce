import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import completeCheckoutSessionWorkflow from "../../../../../workflows/complete-checkout-session"
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../../../lib/cart-fields"
import { getPublicBaseUrl } from "../../../../../lib/public-url"
import { extractUcpPayment } from "../../../../../lib/extract-ucp-payment"
import { ucpErrorFor, ucpVersionFor, ucpWireFor } from "../../../../../lib/ucp-version"
import { CompleteUcpCheckoutSessionSchema } from "../../../../validation-schemas"
import {
  checkPrismInstrument,
  checkQuoteBinding,
  formatZodIssuePath,
  isPrismProvider,
  type GuardFailure,
} from "../../../../../lib/ucp-complete-guard"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const ucpVersion = ucpVersionFor(req)
  const wire = ucpWireFor(req)

  const reject = (failure: GuardFailure) => {
    res.status(failure.status).json(ucpErrorFor(req, {
      code: failure.code,
      content: failure.content,
      severity: "unrecoverable",
    }))
  }

  const parsed = CompleteUcpCheckoutSessionSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    reject({
      status: 400,
      code: "invalid_instrument",
      content: `Invalid or missing field: ${formatZodIssuePath(parsed.error.issues)}`,
    })
    return
  }
  const body = parsed.data

  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  const paymentProviderId = agenticCommerceService.getPaymentProviderId()

  const extracted = extractUcpPayment(body)
  if (!extracted) {
    res.status(400).json(ucpErrorFor(req, {
      code: "missing_payment",
      content: "Payment is required to complete checkout. Provide payment.instruments with a valid credential.",
    }))
    return
  }

  const { eip3009Authorization, x402Version, handlerId, instrumentType } = extracted
  const instrument = body.payment!.instruments[0]

  if (isPrismProvider(paymentProviderId)) {
    const instrumentFailure = checkPrismInstrument(instrument)
    if (instrumentFailure) {
      reject(instrumentFailure)
      return
    }
  }

  const query = req.scope.resolve("query") as any
  const { data: [cartForValidation] } = await query.graph({
    entity: "cart",
    fields: ["id", "metadata"],
    filters: { id },
  })
  const bindingFailure = checkQuoteBinding(cartForValidation?.metadata, handlerId, instrument.credential)
  if (bindingFailure) {
    reject(bindingFailure)
    return
  }

  try {
    const { result } = await completeCheckoutSessionWorkflow(req.scope).run({
      input: {
        cart_id: id,
        payment_provider_id: paymentProviderId,
        ucp_version: ucpVersion,
        payment_data: {
          eip3009_authorization: eip3009Authorization,
          x402_version: x402Version,
          handler_id: handlerId,
          instrument_type: instrumentType,
        },
      },
    })

    // Enrich cart metadata with payment details and completion timestamp
    const { data: [cartForMeta] } = await query.graph({
      entity: "cart",
      fields: ["id", "metadata", "total", "currency_code"],
      filters: { id },
    })
    if (cartForMeta) {
      const cartModuleService = req.scope.resolve("cart") as any
      await cartModuleService.updateCarts(id, {
        metadata: {
          ...cartForMeta.metadata,
          payment_method: eip3009Authorization ? "x402" : "other",
          payment_amount: cartForMeta.total != null ? String(cartForMeta.total / 100) : null,
          payment_currency: cartForMeta.currency_code || null,
          checkout_session_completed_at: new Date().toISOString(),
        },
      })
    }

    // Fetch completed cart for formatting (includes the cart→order link)
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    // Resolve the actual order id from whichever source is available.
    // The workflow result is authoritative for a fresh completion, but the cart's
    // `order` link is the fallback when the workflow returns an idempotent success
    // (e.g., cart was already completed in a previous call).
    const orderId: string | null =
      (result as any)?.order_id || (cart as any)?.order?.id || null

    // Invariant: a successful complete must produce an order. If we got here
    // without an order id, the payment authorized but the order wasn't created
    // — surface as an error rather than lying that status is "completed".
    if (!orderId) {
      res.status(500).json(ucpErrorFor(req, {
        code: "order_not_created",
        content: "Checkout completion did not produce an order. Please retry or contact support.",
        severity: "unrecoverable",
      }))
      return
    }

    // Extract on-chain settlement details from the active payment session.
    // We read PSP-agnostic keys (transaction_reference / transaction_status /
    // transaction_network) that any blockchain-settling payment provider can
    // populate. Falls back to the Prism-specific keys for older provider
    // versions.
    const paymentSessions = (cart as any)?.payment_collection?.payment_sessions || []
    const activeSession = paymentSessions.find((s: any) =>
      s.status === "authorized" || s.status === "captured"
    ) || paymentSessions[0]
    const sessionData = activeSession?.data || {}
    const txReference: string | null =
      sessionData.transaction_reference || sessionData.prism_tx_id || null
    const txStatus: string | null =
      sessionData.transaction_status || sessionData.prism_status || null
    const txNetwork: string | null =
      sessionData.transaction_network || sessionData.network || null

    const baseUrl = `${getPublicBaseUrl(req)}/ucp/checkout-sessions`
    const completedHandlerId = wire.completedPaymentHandlerId(handlerId)
    const session = agenticCommerceService.formatUcpCheckoutSession(cart || {}, baseUrl, undefined, ucpVersion)

    res.json({
      ...session,
      status: "completed",
      order: {
        id: orderId,
        checkout_id: id,
        permalink_url: `${agenticCommerceService.getStorefrontUrl()}/orders/${orderId}`,
        links: [{ type: "self", url: `${getPublicBaseUrl(req)}/ucp/orders/${orderId}` }],
        // Payment settlement details — surfaces the on-chain tx hash so agents
        // can verify settlement without additional calls. Provider-agnostic:
        // any blockchain-settling handler that writes transaction_* keys to
        // its payment session data will appear here.
        ...(txReference || txStatus
          ? {
              payment: {
                ...(completedHandlerId ? { handler_id: completedHandlerId } : {}),
                status: txStatus || "settled",
                ...(txReference ? { transaction: txReference } : {}),
                ...(txNetwork ? { network: txNetwork } : {}),
              },
            }
          : {}),
      },
    })
  } catch (error: unknown) {
    console.error(`[agentic-commerce] UCP checkout complete failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
    // On payment failure, refresh payment state
    try {
      await refreshPaymentCollectionForCartWorkflow(req.scope).run({
        input: { cart_id: id },
      })
    } catch {
      // Best effort cleanup
    }

    res.status(422).json(ucpErrorFor(req, {
      code: "payment_failed",
      content: "Payment could not be completed. Check the payment credential and retry.",
      severity: "unrecoverable",
    }))
  }
}
