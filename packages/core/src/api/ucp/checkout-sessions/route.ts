import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import createCheckoutSessionWorkflow from "../../../workflows/create-checkout-session"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../lib/cart-fields"
import { ucpAddressToMedusa } from "../../../lib/address-translator"
import { formatUcpError } from "../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../lib/public-url"
import { computeSessionFingerprint } from "../../../lib/session-ownership"
import { findRegionForCountry, getSupportedCountries } from "../../../lib/resolve-region"

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
      ? {
          ...ucpAddressToMedusa(body.shipping_address),
          // Buyer name fields also populate the shipping address name
          ...(body.buyer?.first_name ? { first_name: body.buyer.first_name } : {}),
          ...(body.buyer?.last_name ? { last_name: body.buyer.last_name } : {}),
          ...(body.buyer?.phone_number ? { phone: body.buyer.phone_number } : {}),
        }
      : undefined
    let regionId: string | undefined = body.context?.region_id
    const currencyCode = body.context?.currency

    // If the agent supplied a shipping address, pick a region whose country
    // list includes the target country. Prevents the cart from being created
    // under a region that doesn't serve the destination and later rejecting
    // the same address on update.
    if (!regionId && shippingAddress?.country_code) {
      const match = await findRegionForCountry(req.scope, shippingAddress.country_code)
      if (!match) {
        const supported = await getSupportedCountries(req.scope)
        res.status(400).json(formatUcpError({
          ucpVersion: UCP_VERSION,
          code: "country_not_supported",
          content: `Country "${shippingAddress.country_code}" is not served by any region. Supported countries: ${supported.join(", ") || "(none configured)"}.`,
          severity: "recoverable",
          path: "$.shipping_address.address_country",
        }))
        return
      }
      regionId = match.id
    }

    const agentIdentifier = req.headers["ucp-agent"] as string | undefined

    const { result: cart } = await createCheckoutSessionWorkflow(req.scope).run({
      input: {
        items,
        email,
        shipping_address: shippingAddress,
        region_id: regionId,
        currency_code: currencyCode,
        protocol: "ucp",
        agent_identifier: agentIdentifier,
        protocol_version: UCP_VERSION,
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
    const msg: string = error?.message || ""
    if (/Country with code .* is not within region/i.test(msg)) {
      res.status(400).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "country_not_supported",
        content: msg,
        severity: "recoverable",
        path: "$.shipping_address.address_country",
      }))
      return
    }
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: msg || "Internal error",
    }))
  }
}
