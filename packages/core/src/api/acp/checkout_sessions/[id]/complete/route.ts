import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import completeCheckoutSessionWorkflow from "../../../../../workflows/complete-checkout-session"
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"
import { formatAcpError, httpStatusToAcpType } from "../../../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../../../lib/public-url"
import { extractSignedSummary } from "../../../../../lib/validate-signed-amount"
import { checkQuoteBinding, isPrismProvider, PRISM_UCP_HANDLER_ID } from "../../../../../lib/ucp-complete-guard"
import { agentSessions, fetchSessionCart, handlerDataOf } from "../../../../../lib/agent-session"
import { recordSettledPayment } from "../../../../../lib/settled-payment-record"

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

  if (isPrismProvider(paymentProviderId)) {
    const session = await agentSessions(req.scope).find(id)
    const bindingFailure = checkQuoteBinding(
      handlerDataOf(session)[PRISM_UCP_HANDLER_ID],
      paymentHandlerId,
      extractSignedSummary(eip3009Authorization),
      "acp",
    )
    if (bindingFailure) {
      res.status(bindingFailure.status).json(formatAcpError({
        type: "invalid_request",
        code: bindingFailure.code,
        message: bindingFailure.content,
        httpStatus: bindingFailure.status,
      }))
      return
    }
  }

  try {
    const { result } = await completeCheckoutSessionWorkflow(req.scope).run({
      input: {
        cart_id: id,
        payment_provider_id: paymentProviderId,
        ucp_version: agenticCommerceService.getUcpVersion(),
        payment_data: eip3009Authorization
          ? {
              eip3009_authorization: eip3009Authorization,
              x402_version: x402Version,
              handler_id: paymentHandlerId,
            }
          : undefined,
      },
    })

    const completedCart = await fetchSessionCart(req.scope, id)
    const cart = completedCart
      ? await recordSettledPayment(req.scope, id, completedCart, eip3009Authorization ? "x402" : "other")
      : completedCart

    // Resolve order id: prefer the workflow result, fall back to the cart link.
    const orderId: string | null =
      (result as any)?.order_id || (cart as any)?.order?.id || null

    if (!orderId) {
      res.status(500).json(formatAcpError({
        type: "processing_error",
        code: "order_not_created",
        message: "Checkout completion did not produce an order.",
        httpStatus: 500,
      }))
      return
    }

    const baseUrl = `${getPublicBaseUrl(req)}/acp/checkout_sessions`
    const response = agenticCommerceService.formatAcpCompleteResponse(
      cart || {},
      baseUrl,
      orderId,
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
