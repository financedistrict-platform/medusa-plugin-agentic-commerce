import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_FIELDS, FULFILLMENT_FIELDS } from "../../../../lib/order-fields"
import { formatUcpError } from "../../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../../lib/public-url"

const UCP_VERSION = "2026-01-11"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const query = req.scope.resolve("query") as any
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: [...ORDER_FIELDS, "cart_id"],
      filters: { id },
    })

    if (!order) {
      res.status(404).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "not_found",
        content: "Order not found",
      }))
      return
    }

    // Fulfillments are a separate module — query via order link
    try {
      const { data: fulfillments } = await query.graph({
        entity: "order_fulfillment",
        fields: FULFILLMENT_FIELDS,
        filters: { order_id: id },
      })
      order.fulfillments = fulfillments || []
    } catch {
      order.fulfillments = []
    }

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/ucp/orders`
    const formatted = agenticCommerceService.formatUcpOrder(order, baseUrl)

    res.json(formatted)
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}
