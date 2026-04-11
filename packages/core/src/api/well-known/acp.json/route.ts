import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPublicBaseUrl } from "../../../lib/public-url"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const baseUrl = getPublicBaseUrl(req)
  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  const paymentHandlers = agenticCommerceService.getPaymentHandlerService()

  const acpVersion = agenticCommerceService.getAcpVersion()

  // Fetch supported currencies from regions
  let supportedCurrencies: string[] = ["eur"]
  try {
    const query = req.scope.resolve("query") as any
    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["currency_code"],
    })
    if (regions.length > 0) {
      supportedCurrencies = [...new Set(regions.map((r: any) => r.currency_code))] as string[]
    }
  } catch {
    // Fall back to default
  }

  const handlers = await paymentHandlers.getAcpDiscoveryHandlers()

  res.json({
    protocol: {
      name: "acp",
      version: acpVersion,
      supported_versions: [acpVersion],
    },
    api_base_url: `${baseUrl}/acp`,
    transports: ["rest"],
    capabilities: {
      services: ["checkout", "orders"],
      payment: {
        handlers,
      },
      supported_currencies: supportedCurrencies,
      supported_locales: ["en"],
    },
  })
}
