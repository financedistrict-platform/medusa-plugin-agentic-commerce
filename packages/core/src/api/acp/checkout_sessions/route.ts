import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import createCheckoutSessionWorkflow from "../../../workflows/create-checkout-session"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../lib/cart-fields"
import { acpAddressToMedusa } from "../../../lib/address-translator"
import { formatAcpError, httpStatusToAcpType } from "../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../lib/public-url"
import { computeSessionFingerprint } from "../../../lib/session-ownership"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.validatedBody as any

    // Translate ACP field names to internal Medusa format
    const items = (body.items || []).map((i: any) => ({
      variant_id: i.id,
      quantity: i.quantity,
    }))

    const email = body.buyer?.email
    const shippingAddress = body.fulfillment_details?.address
      ? acpAddressToMedusa(body.fulfillment_details.address)
      : undefined

    const agentIdentifier = req.headers["user-agent"] as string | undefined
    const protocolVersion = req.headers["api-version"] as string | undefined

    const { result: cart } = await createCheckoutSessionWorkflow(req.scope).run({
      input: {
        items,
        email,
        shipping_address: shippingAddress,
        webhook_url: body.webhook_url,
        region_id: body.region_id,
        currency_code: body.currency_code,
        protocol: "acp",
        agent_identifier: agentIdentifier,
        protocol_version: protocolVersion,
        session_fingerprint: computeSessionFingerprint(req),
      } as any,
    })

    // Fetch full cart for formatting (need totals for checkout-prepare)
    const query = req.scope.resolve("query") as any
    const { data: [fullCart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id: cart.id },
    })

    // Step 2: Call Prism checkout-prepare to get x402 payment requirements
    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const paymentHandlers = agenticCommerceService.getPaymentHandlerService()
    const checkoutBaseUrl = `${getPublicBaseUrl(req)}/acp/checkout_sessions`

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

    const session = agenticCommerceService.formatAcpCheckoutSession(
      cartWithPayment || fullCart,
      checkoutBaseUrl
    )

    res.status(201).json(session)
  } catch (error: any) {
    const statusCode = error.type === "invalid_data" ? 400 : 500
    res.status(statusCode).json(formatAcpError({
      type: httpStatusToAcpType(statusCode),
      code: error.type || "internal_error",
      message: error.message,
    }))
  }
}
