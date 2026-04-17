import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import completeCheckoutSessionWorkflow from "../../../../../workflows/complete-checkout-session"
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../../../lib/cart-fields"
import { formatAcpError, httpStatusToAcpType } from "../../../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../../../lib/public-url"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  const paymentProviderId = agenticCommerceService.getPaymentProviderId()
  const body = req.validatedBody as any

  // Translate ACP instrument credential to internal format
  // Supports both new (authorization) and legacy (token) credential fields
  const credential = body?.payment_data?.instrument?.credential
  const eip3009Authorization = credential?.authorization || credential?.token
  const x402Version = credential?.x402_version
  const paymentHandlerId = body?.payment_data?.handler_id

  // F6: Require payment credentials to prevent completing checkout without paying
  if (!eip3009Authorization) {
    res.status(400).json(formatAcpError({
      type: "invalid_request",
      code: "missing_payment_data",
      message: "Payment data with valid instrument credentials is required to complete checkout.",
      httpStatus: 400,
    }))
    return
  }

  try {
    const { result } = await completeCheckoutSessionWorkflow(req.scope).run({
      input: {
        cart_id: id,
        payment_provider_id: paymentProviderId,
        payment_data: eip3009Authorization
          ? {
              eip3009_authorization: eip3009Authorization,
              x402_version: x402Version,
              handler_id: paymentHandlerId,
            }
          : undefined,
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

    const baseUrl = `${getPublicBaseUrl(req)}/acp/checkout_sessions`
    const response = agenticCommerceService.formatAcpCompleteResponse(
      cart || {},
      baseUrl,
      result.order_id || null,
      id
    )

    res.json(response)
  } catch (error: any) {
    // On payment failure, refresh payment state so cart isn't stuck
    try {
      await refreshPaymentCollectionForCartWorkflow(req.scope).run({
        input: { cart_id: id },
      })
    } catch {
      // Best effort cleanup
    }

    const statusCode = error.type === "not_found" ? 404
      : error.type === "duplicate_error" ? 409
      : error.type === "not_allowed" ? 410
      : error.type === "invalid_data" ? 400
      : 500

    res.status(statusCode).json(formatAcpError({
      type: httpStatusToAcpType(statusCode),
      code: error.type === "duplicate_error" ? "already_completed"
        : error.type === "not_allowed" ? "session_canceled"
        : error.type === "invalid_data" ? "invalid_request"
        : "checkout_failed",
      message: error.message,
    }))
  }
}
