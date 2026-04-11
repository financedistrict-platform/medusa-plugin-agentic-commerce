import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import cancelCheckoutSessionWorkflow from "../../../../../workflows/cancel-checkout-session"
import { formatUcpError } from "../../../../../lib/error-formatters"

const UCP_VERSION = "2026-01-11"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const { result } = await cancelCheckoutSessionWorkflow(req.scope).run({
      input: { cart_id: id },
    })

    res.json({
      ucp: { version: UCP_VERSION, status: "success" },
      id,
      status: "canceled",
      currency: null,
      line_items: [],
      totals: [],
      messages: [
        { type: "info", code: "session_canceled", content: "Checkout session has been cancelled.", severity: "info" },
      ],
      links: [],
    })
  } catch (error: any) {
    const statusCode = error.message?.includes("not found") ? 404
      : error.message?.includes("completed") ? 409
      : 500

    res.status(statusCode).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: statusCode === 404 ? "not_found" : statusCode === 409 ? "already_completed" : "internal_error",
      content: error.message,
    }))
  }
}
