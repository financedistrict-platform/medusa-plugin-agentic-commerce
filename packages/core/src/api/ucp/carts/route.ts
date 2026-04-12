import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import createCheckoutSessionWorkflow from "../../../workflows/create-checkout-session"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../lib/cart-fields"
import { formatUcpError } from "../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../lib/public-url"

const UCP_VERSION = "2026-01-11"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.validatedBody as any

  try {
    // Translate UCP field names to internal format
    const items = (body.line_items || []).map((li: any) => ({
      variant_id: li.item.id,
      quantity: li.quantity,
    }))

    const email = body.buyer?.email
    const regionId = body.context?.region
    const currencyCode = body.context?.currency

    const agentIdentifier = req.headers["ucp-agent"] as string | undefined

    const { result: cart } = await createCheckoutSessionWorkflow(req.scope).run({
      input: {
        items,
        email,
        region_id: regionId,
        currency_code: currencyCode,
        protocol: "ucp",
        agent_identifier: agentIdentifier,
        protocol_version: UCP_VERSION,
      },
    })

    // Fetch full cart for formatting
    const query = req.scope.resolve("query") as any
    const { data: [fullCart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id: cart.id },
    })

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/ucp/carts`
    const formatted = agenticCommerceService.formatUcpCart(fullCart, baseUrl)

    res.status(201).json(formatted)
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}
