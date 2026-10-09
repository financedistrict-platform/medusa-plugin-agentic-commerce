import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import createCheckoutSessionWorkflow from "../../../workflows/create-checkout-session"
import { fetchSessionCart } from "../../../lib/agent-session"
import { getPublicBaseUrl } from "../../../lib/public-url"
import { computeSessionFingerprint } from "../../../lib/session-ownership"
import { ucpErrorFor, ucpVersionFor, type UcpRequestLike } from "../../../lib/ucp-version"

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
        protocol_version: ucpVersionFor(req),
        ucp_version: (req as UcpRequestLike).ucp?.outcome === "matched" ? ucpVersionFor(req) : undefined,
        session_fingerprint: computeSessionFingerprint(req),
      },
    })

    // Fetch full cart for formatting
    const fullCart = await fetchSessionCart(req.scope, cart.id)

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/ucp/carts`
    const formatted = agenticCommerceService.formatUcpCart(fullCart, baseUrl, ucpVersionFor(req))

    res.status(201).json(formatted)
  } catch (error: any) {
    res.status(500).json(ucpErrorFor(req, {
      code: "internal_error",
      content: error.message,
    }))
  }
}
