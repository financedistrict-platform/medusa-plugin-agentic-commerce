import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPublicBaseUrl } from "../../../lib/public-url"
import { buildUcpProfile } from "../../../lib/ucp-profile"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  const handlers = await agenticCommerceService.getPaymentHandlerService().getUcpDiscoveryHandlers()

  res.json(buildUcpProfile(
    agenticCommerceService.getUcpVersion(),
    getPublicBaseUrl(req),
    agenticCommerceService.getStoreName(),
    handlers,
  ))
}
