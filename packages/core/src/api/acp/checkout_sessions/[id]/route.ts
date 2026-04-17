import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import updateCheckoutSessionWorkflow from "../../../../workflows/update-checkout-session"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../../lib/cart-fields"
import { acpAddressToMedusa } from "../../../../lib/address-translator"
import { formatAcpError, httpStatusToAcpType } from "../../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../../lib/public-url"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const query = req.scope.resolve("query") as any
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    if (!cart) {
      res.status(404).json(formatAcpError({
        code: "not_found",
        message: "Checkout session not found",
        httpStatus: 404,
      }))
      return
    }

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/acp/checkout_sessions`
    const session = agenticCommerceService.formatAcpCheckoutSession(cart, baseUrl)

    res.json(session)
  } catch (error: any) {
    res.status(500).json(formatAcpError({
      code: "internal_error",
      message: error.message,
      httpStatus: 500,
    }))
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = req.validatedBody as any

    // Translate ACP line_items (spec Item: {id, name?, unit_amount?}; duplicates imply qty)
    let items: any[] | undefined
    if (body.line_items) {
      const counts = new Map<string, { variant_id: string; quantity: number }>()
      for (const it of body.line_items) {
        const qty = typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : 1
        const existing = counts.get(it.id)
        if (existing) existing.quantity += qty
        else counts.set(it.id, { variant_id: it.id, quantity: qty })
      }
      items = Array.from(counts.values())
    }

    const email = body.buyer?.email
    const shippingAddress = body.fulfillment_details?.address
      ? {
          ...acpAddressToMedusa(body.fulfillment_details.address),
          ...(body.fulfillment_details.phone_number ? { phone: body.fulfillment_details.phone_number } : {}),
        }
      : undefined

    // Spec uses selected_fulfillment_options (array) rather than single fulfillment_option_id
    const fulfillmentOptionId =
      body.selected_fulfillment_options?.[0]?.fulfillment_option_id

    await updateCheckoutSessionWorkflow(req.scope).run({
      input: {
        cart_id: id,
        items,
        email,
        shipping_address: shippingAddress,
        fulfillment_option_id: fulfillmentOptionId,
      } as any,
    })

    // Fetch updated cart for formatting
    const query = req.scope.resolve("query") as any
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    if (!cart) {
      res.status(404).json(formatAcpError({
        code: "not_found",
        message: "Checkout session not found",
        httpStatus: 404,
      }))
      return
    }

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/acp/checkout_sessions`

    // Re-prepare payment requirements if total changed
    const paymentHandlers = agenticCommerceService.getPaymentHandlerService()
    await paymentHandlers.prepareCheckoutPayment({
      cart,
      checkoutBaseUrl: baseUrl,
      storeName: agenticCommerceService.getStoreName(),
      container: req.scope,
    })

    // Re-fetch to include metadata updates
    const { data: [updatedCart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    const session = agenticCommerceService.formatAcpCheckoutSession(updatedCart || cart, baseUrl)

    res.json(session)
  } catch (error: any) {
    const statusCode = error.type === "invalid_data" ? 400 : 500
    res.status(statusCode).json(formatAcpError({
      type: httpStatusToAcpType(statusCode),
      code: error.type || "internal_error",
      message: error.message,
    }))
  }
}
