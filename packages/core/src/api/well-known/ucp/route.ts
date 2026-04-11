import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPublicBaseUrl } from "../../../lib/public-url"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const baseUrl = getPublicBaseUrl(req)
  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  const paymentHandlers = agenticCommerceService.getPaymentHandlerService()

  const ucpVersion = agenticCommerceService.getUcpVersion()
  const handlers = await paymentHandlers.getUcpDiscoveryHandlers()

  res.json({
    ucp: {
      version: ucpVersion,

      services: {
        "dev.ucp.shopping": [
          {
            version: ucpVersion,
            transport: "rest",
            endpoint: `${baseUrl}/ucp`,
          },
        ],
      },

      capabilities: {
        "dev.ucp.shopping.catalog.search": [{ version: ucpVersion }],
        "dev.ucp.shopping.catalog.lookup": [{ version: ucpVersion }],
        "dev.ucp.shopping.checkout": [{ version: ucpVersion }],
        "dev.ucp.shopping.cart": [{ version: ucpVersion }],
        "dev.ucp.shopping.order": [{ version: ucpVersion }],
      },

      payment_handlers: handlers,
    },
  })
}
