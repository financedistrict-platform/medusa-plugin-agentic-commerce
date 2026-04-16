import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import completeCheckoutSessionWorkflow from "../../../../../workflows/complete-checkout-session"
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../../../lib/cart-fields"
import { formatUcpError } from "../../../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../../../lib/public-url"
import { extractUcpPayment } from "../../../../../lib/extract-ucp-payment"

const UCP_VERSION = "2026-01-11"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const body = req.validatedBody as any

  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  const paymentProviderId = agenticCommerceService.getPaymentProviderId()

  // Extract payment from UCP spec (payment.instruments[]) or legacy (payment_credentials)
  const extracted = extractUcpPayment(body || {})

  // F6: Require payment credentials to prevent completing checkout without paying
  if (!extracted) {
    res.status(400).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "missing_payment",
      content: "Payment is required to complete checkout. Provide payment.instruments with a valid credential.",
    }))
    return
  }

  const { eip3009Authorization, x402Version, handlerId } = extracted

  try {
    const { result } = await completeCheckoutSessionWorkflow(req.scope).run({
      input: {
        cart_id: id,
        payment_provider_id: paymentProviderId,
        payment_data: {
          eip3009_authorization: eip3009Authorization,
          x402_version: x402Version,
          handler_id: handlerId,
        },
      },
    })

    // Enrich cart metadata with payment details and completion timestamp
    const query = req.scope.resolve("query") as any
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

    // Fetch completed cart for formatting
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    const baseUrl = `${getPublicBaseUrl(req)}/ucp/checkout-sessions`
    const session = agenticCommerceService.formatUcpCheckoutSession(cart || {}, baseUrl)

    res.json({
      ...session,
      status: "completed",
      order: result.order_id
        ? {
            id: result.order_id,
            checkout_id: id,
            permalink_url: `${agenticCommerceService.getStorefrontUrl()}/orders/${result.order_id}`,
            links: [{ type: "self", url: `${getPublicBaseUrl(req)}/ucp/orders/${result.order_id}` }],
          }
        : null,
    })
  } catch (error: any) {
    // On payment failure, refresh payment state
    try {
      await refreshPaymentCollectionForCartWorkflow(req.scope).run({
        input: { cart_id: id },
      })
    } catch {
      // Best effort cleanup
    }

    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "checkout_failed",
      content: error.message,
    }))
  }
}
