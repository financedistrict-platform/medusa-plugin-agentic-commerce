import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import cancelCheckoutSessionWorkflow from "../../../../../workflows/cancel-checkout-session"
import { ucpErrorFor, ucpVersionFor } from "../../../../../lib/ucp-version"
import { sessionLockedCodeOf } from "../../../../../workflows/steps/assert-session-mutable"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const { result } = await cancelCheckoutSessionWorkflow(req.scope).run({
      input: { cart_id: id },
    })

    res.json({
      ucp: { version: ucpVersionFor(req), status: "success" },
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
    const locked = sessionLockedCodeOf(error)
    if (locked) {
      res.status(409).json(ucpErrorFor(req, {
        code: locked,
        content: error.message,
        severity: "recoverable",
      }))
      return
    }
    const statusCode = error.message?.includes("not found") ? 404
      : error.message?.includes("completed") ? 409
      : 500

    res.status(statusCode).json(ucpErrorFor(req, {
      code: statusCode === 404 ? "not_found" : statusCode === 409 ? "already_completed" : "internal_error",
      content: error.message,
    }))
  }
}
