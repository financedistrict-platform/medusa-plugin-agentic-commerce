import { ucpSpecBase } from "./ucp-wire/types"

export type UcpProfileCapability = {
  name: string
  spec: string
  schema: string
  extends?: string
}

export const UCP_PROFILE_CAPABILITIES: readonly UcpProfileCapability[] = [
  { name: "dev.ucp.shopping.catalog.search", spec: "catalog/search", schema: "catalog_search.json" },
  { name: "dev.ucp.shopping.catalog.lookup", spec: "catalog/lookup", schema: "catalog_lookup.json" },
  { name: "dev.ucp.shopping.checkout", spec: "checkout/", schema: "checkout.json" },
  { name: "dev.ucp.shopping.fulfillment", spec: "fulfillment/", schema: "fulfillment.json", extends: "dev.ucp.shopping.checkout" },
  { name: "dev.ucp.shopping.cart", spec: "cart/", schema: "cart.json" },
  { name: "dev.ucp.shopping.order", spec: "order/", schema: "order.json" },
]

export function buildUcpProfile(
  ucpVersion: string,
  baseUrl: string,
  storeName: string,
  handlers: Record<string, unknown[]>,
  capabilities: readonly UcpProfileCapability[] = UCP_PROFILE_CAPABILITIES,
  serviceSchemaFile = "rest.openapi.json",
) {
  const specBase = ucpSpecBase(ucpVersion)
  const capabilityBlock: Record<string, Record<string, unknown>[]> = {}
  for (const capability of capabilities) {
    capabilityBlock[capability.name] = [{
      version: ucpVersion,
      spec: `${specBase}/specification/${capability.spec}`,
      schema: `${specBase}/schemas/shopping/${capability.schema}`,
      ...(capability.extends ? { extends: capability.extends } : {}),
    }]
  }

  return {
    ucp: {
      version: ucpVersion,
      services: {
        "dev.ucp.shopping": [{
          version: ucpVersion,
          spec: `${specBase}/specification/overview`,
          schema: `${specBase}/services/shopping/${serviceSchemaFile}`,
          transport: "rest",
          endpoint: `${baseUrl}/ucp`,
        }],
      },
      capabilities: capabilityBlock,
      payment_handlers: handlers,
    },
    name: storeName,
  }
}
