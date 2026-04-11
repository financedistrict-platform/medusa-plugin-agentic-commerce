import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import createCheckoutSessionWorkflow from "../../../workflows/create-checkout-session"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../lib/cart-fields"
import { ucpAddressToMedusa } from "../../../lib/address-translator"
import { formatUcpError } from "../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../lib/public-url"

const UCP_VERSION = "2026-01-11"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.validatedBody as any

    // Translate UCP field names to internal Medusa format
    const items = (body.line_items || []).map((li: any) => ({
      variant_id: li.item.id,
      quantity: li.quantity,
    }))

    const email = body.buyer?.email
    const shippingAddress = body.shipping_address
      ? ucpAddressToMedusa(body.shipping_address)
      : undefined
    const regionId = body.context?.region
    const currencyCode = body.context?.currency

    const { result: cart } = await createCheckoutSessionWorkflow(req.scope).run({
      input: {
        items,
        email,
        shipping_address: shippingAddress,
        region_id: regionId,
        currency_code: currencyCode,
        protocol: "ucp",
      } as any,
    })

    // Fetch full cart for formatting (need totals for checkout-prepare)
    const query = req.scope.resolve("query") as any
    const { data: [fullCart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id: cart.id },
    })

    // Step 2: Call Prism checkout-prepare to get x402 payment requirements.
    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const paymentHandlers = agenticCommerceService.getPaymentHandlerService()
    const checkoutBaseUrl = `${getPublicBaseUrl(req)}/ucp/checkout-sessions`

    await paymentHandlers.prepareCheckoutPayment({
      cart: fullCart,
      checkoutBaseUrl,
      storeName: agenticCommerceService.getStoreName(),
      container: req.scope,
    })

    // Re-fetch cart to include updated metadata
    const { data: [cartWithPayment] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id: cart.id },
    })

    const session = agenticCommerceService.formatUcpCheckoutSession(
      cartWithPayment || fullCart,
      checkoutBaseUrl
    )

    res.status(201).json(session)
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}
