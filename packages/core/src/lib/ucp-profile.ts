import { ucpSpecBase } from "./ucp-version"

export function buildUcpProfile(
  ucpVersion: string,
  baseUrl: string,
  storeName: string,
  handlers: Record<string, unknown[]>,
) {
  const specBase = ucpSpecBase(ucpVersion)
  const capability = (spec: string, schema: string, extra: Record<string, unknown> = {}) => [{
    version: ucpVersion,
    spec: `${specBase}/specification/${spec}`,
    schema: `${specBase}/schemas/shopping/${schema}`,
    ...extra,
  }]

  return {
    ucp: {
      version: ucpVersion,
      services: {
        "dev.ucp.shopping": [{
          version: ucpVersion,
          spec: `${specBase}/specification/overview`,
          schema: `${specBase}/services/shopping/rest.openapi.json`,
          transport: "rest",
          endpoint: `${baseUrl}/ucp`,
        }],
      },
      capabilities: {
        "dev.ucp.shopping.catalog.search": capability("catalog/search", "catalog_search.json"),
        "dev.ucp.shopping.catalog.lookup": capability("catalog/lookup", "catalog_lookup.json"),
        "dev.ucp.shopping.checkout": capability("checkout/", "checkout.json"),
        "dev.ucp.shopping.fulfillment": capability("fulfillment/", "fulfillment.json", {
          extends: "dev.ucp.shopping.checkout",
        }),
        "dev.ucp.shopping.cart": capability("cart/", "cart.json"),
        "dev.ucp.shopping.order": capability("order/", "order.json"),
      },
      payment_handlers: handlers,
    },
    name: storeName,
  }
}
