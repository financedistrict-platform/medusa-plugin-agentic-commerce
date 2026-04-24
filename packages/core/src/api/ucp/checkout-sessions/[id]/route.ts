import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import updateCheckoutSessionWorkflow from "../../../../workflows/update-checkout-session"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../../lib/cart-fields"
import { ucpAddressToMedusa } from "../../../../lib/address-translator"
import { formatUcpError } from "../../../../lib/error-formatters"
import { getPublicBaseUrl } from "../../../../lib/public-url"
import { resolveRegionForAddressUpdate } from "../../../../lib/resolve-region"
import { listShippingOptionsSafe } from "../../../../lib/list-shipping-options"
import { extractSelectedFulfillmentOptionId } from "../../../../lib/formatters/ucp-fulfillment"

const UCP_VERSION = "2026-01-11"

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
      res.status(404).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "not_found",
        content: "Checkout session not found",
      }))
      return
    }

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/ucp/checkout-sessions`
    const shippingOptions = await listShippingOptionsSafe(req.scope, id)
    const session = agenticCommerceService.formatUcpCheckoutSession(cart, baseUrl, shippingOptions)

    res.json(session)
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
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

    // UCP Fulfillment Extension: agent selects a shipping option by setting
    // `selected_option_id` on a group inside body.fulfillment.methods[].groups[].
    // We extract that here and pass it as fulfillment_option_id into the
    // update workflow (which is already wired to apply it as a Medusa
    // shipping method).
    const fulfillmentOptionId = extractSelectedFulfillmentOptionId(body.fulfillment)

    // Region resolution: if the incoming address targets a country that is not
    // in the cart's current region, look up a region that supports it and
    // switch the cart to that region first. If no region supports it, emit a
    // spec-compliant recoverable error listing the countries that would work.
    let regionId: string | undefined
    if (shippingAddress?.country_code) {
      const resolution = await resolveRegionForAddressUpdate(
        req.scope,
        id,
        shippingAddress.country_code
      )
      if (!resolution.supported) {
        res.status(400).json(formatUcpError({
          ucpVersion: UCP_VERSION,
          code: "country_not_supported",
          content: `Country "${shippingAddress.country_code}" is not served by any region. Supported countries: ${resolution.supportedCountries.join(", ") || "(none configured)"}.`,
          severity: "recoverable",
          path: "$.shipping_address.address_country",
        }))
        return
      }
      if (resolution.shouldSwitch) {
        regionId = resolution.regionId
      }
    }

    await updateCheckoutSessionWorkflow(req.scope).run({
      input: {
        cart_id: id,
        items,
        email,
        shipping_address: shippingAddress,
        region_id: regionId,
        fulfillment_option_id: fulfillmentOptionId,
      } as any,
    })

    // Fetch updated cart
    const query = req.scope.resolve("query") as any
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    if (!cart) {
      res.status(404).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "not_found",
        content: "Checkout session not found",
      }))
      return
    }

    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const baseUrl = `${getPublicBaseUrl(req)}/ucp/checkout-sessions`

    // Re-prepare payment requirements if total changed
    const paymentHandlers = agenticCommerceService.getPaymentHandlerService()
    await paymentHandlers.prepareCheckoutPayment({
      cart,
      checkoutBaseUrl: baseUrl,
      storeName: agenticCommerceService.getStoreName(),
      container: req.scope,
    })

    // Re-fetch to include any metadata updates from checkout-prepare
    const { data: [updatedCart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    const shippingOptions = await listShippingOptionsSafe(req.scope, id)
    const session = agenticCommerceService.formatUcpCheckoutSession(
      updatedCart || cart,
      baseUrl,
      shippingOptions
    )

    res.json(session)
  } catch (error: any) {
    // Translate well-known Medusa errors to spec-compliant UCP errors
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
