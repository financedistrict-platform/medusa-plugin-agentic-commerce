import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { formatUcpError } from "../../../../lib/error-formatters"

const UCP_VERSION = "2026-01-11"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.validatedBody as any
  const ids: string[] = body.ids || []

  try {
    const queryService = req.scope.resolve("query")
    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any

    // IDs can be product IDs or variant IDs — try both
    const { data: products } = await queryService.graph({
      entity: "product",
      fields: [
        "id", "title", "description", "handle", "thumbnail", "status",
        "variants.id", "variants.title", "variants.sku",
        "variants.prices.*",
        "variants.inventory_quantity",
        "categories.id", "categories.name",
        "images.url",
      ],
      filters: { id: ids },
    })

    // Also try to find products by variant IDs for any IDs not found as product IDs
    let allProducts = [...products]
    const foundProductIds = new Set(products.map((p: any) => p.id))
    const remainingIds = ids.filter((id) => !foundProductIds.has(id))

    if (remainingIds.length > 0) {
      const { data: variantProducts } = await queryService.graph({
        entity: "product",
        fields: [
          "id", "title", "description", "handle", "thumbnail", "status",
          "variants.id", "variants.title", "variants.sku",
          "variants.prices.*",
          "variants.inventory_quantity",
          "categories.id", "categories.name",
          "images.url",
        ],
        filters: { variants: { id: remainingIds } },
      })

      for (const p of variantProducts) {
        if (!foundProductIds.has(p.id)) {
          allProducts.push(p)
          foundProductIds.add(p.id)
        }
      }
    }

    const formatted = allProducts
      .filter((p: any) => p.status === "published")
      .map((p: any) => agenticCommerceService.formatUcpProduct(p))

    res.json({
      ucp: { version: UCP_VERSION, status: "success" },
      products: formatted,
      messages: [],
    })
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}
