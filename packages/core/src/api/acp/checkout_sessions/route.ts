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

    // Translate ACP fields (line_items per spec) to internal Medusa format.
    // Per spec Item has no quantity — duplicate entries imply quantity.
    // For merchant convenience our schema also accepts a non-spec `quantity` field.
    const itemCounts = new Map<string, { variant_id: string; quantity: number }>()
    for (const it of (body.line_items || [])) {
      const qty = typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : 1
      const existing = itemCounts.get(it.id)
      if (existing) {
        existing.quantity += qty
      } else {
        itemCounts.set(it.id, { variant_id: it.id, quantity: qty })
      }
    }
    const items = Array.from(itemCounts.values())

    const email = body.buyer?.email
    const shippingAddress = body.fulfillment_details?.address
      ? {
          ...acpAddressToMedusa(body.fulfillment_details.address),
          // phone_number now lives on FulfillmentDetails (not Address) per spec
          ...(body.fulfillment_details.phone_number ? { phone: body.fulfillment_details.phone_number } : {}),
        }
      : undefined

    const agentIdentifier = req.headers["user-agent"] as string | undefined
    const protocolVersion = req.headers["api-version"] as string | undefined

    const { result: cart } = await createCheckoutSessionWorkflow(req.scope).run({
      input: {
        items,
        email,
        shipping_address: shippingAddress,
        // Spec uses `currency`, not `currency_code`
        currency_code: body.currency,
        // metadata stores non-spec webhook_url if provided via metadata
        metadata: body.metadata,
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
