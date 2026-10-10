import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import updateCheckoutSessionWorkflow from "../../../../workflows/update-checkout-session"
import { fetchSessionCart } from "../../../../lib/agent-session"
import { ucpAddressToMedusa } from "../../../../lib/address-translator"
import { getPublicBaseUrl } from "../../../../lib/public-url"
import { ucpErrorFor, ucpVersionFor } from "../../../../lib/ucp-version"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const cart = await fetchSessionCart(req.scope, id)

    if (!cart) {
      res.status(404).json(ucpErrorFor(req, {
        code: "not_found",
        content: "Cart not found",
      }))
      return
    }

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/ucp/carts`
    const formatted = agenticCommerceService.formatUcpCart(cart, baseUrl, ucpVersionFor(req))

    res.json(formatted)
  } catch (error: any) {
    res.status(500).json(ucpErrorFor(req, {
      code: "internal_error",
      content: error.message,
    }))
  }
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = req.validatedBody as any

    // Translate UCP field names to internal format
    const items = body.line_items
      ? body.line_items.map((li: any) => ({
          variant_id: li.item?.id,
          line_item_id: li.line_item_id,
          quantity: li.quantity,
        }))
      : undefined

    const email = body.buyer?.email
    const shippingAddress = body.shipping_address
      ? ucpAddressToMedusa(body.shipping_address)
      : undefined

    await updateCheckoutSessionWorkflow(req.scope).run({
      input: {
        cart_id: id,
        items,
        email,
        shipping_address: shippingAddress,
      } as any,
    })

    // Fetch updated cart
    const cart = await fetchSessionCart(req.scope, id)

    if (!cart) {
      res.status(404).json(ucpErrorFor(req, {
        code: "not_found",
        content: "Cart not found",
      }))
      return
    }

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/ucp/carts`
    const formatted = agenticCommerceService.formatUcpCart(cart, baseUrl, ucpVersionFor(req))

    res.json(formatted)
  } catch (error: any) {
    res.status(500).json(ucpErrorFor(req, {
      code: "internal_error",
      content: error.message,
    }))
  }
}
