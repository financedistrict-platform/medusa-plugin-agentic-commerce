import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import cancelCheckoutSessionWorkflow from "../../../../../workflows/cancel-checkout-session"
import { formatAcpError, httpStatusToAcpType } from "../../../../../lib/error-formatters"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const { result } = await cancelCheckoutSessionWorkflow(req.scope).run({
      input: { cart_id: id },
    })

    res.json({
      id,
      status: "canceled",
      currency: null,
      line_items: [],
      totals: [],
      messages: [
        { type: "info", content_type: "text/plain", content: "Checkout session has been cancelled." },
      ],
      links: [],
      capabilities: {},
    })
  } catch (error: any) {
    const statusCode = error.message?.includes("not found") ? 404
      : error.message?.includes("completed") ? 409
      : 500

    res.status(statusCode).json(formatAcpError({
      type: httpStatusToAcpType(statusCode),
      code: statusCode === 404 ? "not_found" : statusCode === 409 ? "already_completed" : "internal_error",
      message: error.message,
    }))
  }
}
