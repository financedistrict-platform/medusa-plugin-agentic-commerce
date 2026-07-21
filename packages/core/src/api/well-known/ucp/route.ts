import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPublicBaseUrl } from "../../../lib/public-url"

const SPEC_BASE = "https://ucp.dev/2026-04-08"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const baseUrl = getPublicBaseUrl(req)
  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  const paymentHandlers = agenticCommerceService.getPaymentHandlerService()

  const ucpVersion = agenticCommerceService.getUcpVersion()
  const storeName = agenticCommerceService.getStoreName()
  const handlers = await paymentHandlers.getUcpDiscoveryHandlers()

  // Inject name into each handler entry if the Prism Gateway omits it
  const namedHandlers: Record<string, unknown[]> = {}
  for (const [ns, entries] of Object.entries(handlers as Record<string, Record<string, unknown>[]>)) {
    namedHandlers[ns] = entries.map(entry => ("name" in entry ? entry : { ...entry, name: ns }))
  }

  res.json({
    ucp: {
      version: ucpVersion,

      services: {
        "dev.ucp.shopping": [
          {
            version: ucpVersion,
            spec: `${SPEC_BASE}/specification/overview`,
            schema: `${SPEC_BASE}/services/shopping/rest.openapi.json`,
            transport: "rest",
            endpoint: `${baseUrl}/ucp`,
          },
        ],
      },

      capabilities: {
        "dev.ucp.shopping.catalog.search": [{
          version: ucpVersion,
          spec: `${SPEC_BASE}/specification/catalog/`,
          schema: `${SPEC_BASE}/schemas/shopping/catalog.json`,
        }],
        "dev.ucp.shopping.catalog.lookup": [{
          version: ucpVersion,
          spec: `${SPEC_BASE}/specification/catalog/`,
          schema: `${SPEC_BASE}/schemas/shopping/catalog.json`,
        }],
        "dev.ucp.shopping.checkout": [{
          version: ucpVersion,
          spec: `${SPEC_BASE}/specification/checkout/`,
          schema: `${SPEC_BASE}/schemas/shopping/checkout.json`,
        }],
        "dev.ucp.shopping.fulfillment": [{
          version: ucpVersion,
          spec: `${SPEC_BASE}/specification/fulfillment/`,
          schema: `${SPEC_BASE}/schemas/shopping/fulfillment.json`,
          extends: "dev.ucp.shopping.checkout",
        }],
        "dev.ucp.shopping.cart": [{
          version: ucpVersion,
          spec: `${SPEC_BASE}/specification/cart/`,
          schema: `${SPEC_BASE}/schemas/shopping/cart.json`,
        }],
        "dev.ucp.shopping.order": [{
          version: ucpVersion,
          spec: `${SPEC_BASE}/specification/order/`,
          schema: `${SPEC_BASE}/schemas/shopping/order.json`,
        }],
      },

      payment_handlers: namedHandlers,
    },
    name: storeName,
    signing_keys: [],
  })
}
