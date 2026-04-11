import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { formatUcpError } from "../../../../lib/error-formatters"

const UCP_VERSION = "2026-01-11"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.validatedBody as any

  const searchQuery = body.query
  const category = body.filters?.category
  const minPrice = body.filters?.min_price
  const maxPrice = body.filters?.max_price
  const take = Math.min(body.pagination?.limit || 20, 100)
  const skip = body.pagination?.offset || 0

  try {
    const queryService = req.scope.resolve("query")
    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any

    // Fetch all published products for in-memory filtering
    const graphFilters: Record<string, unknown> = { status: "published" }

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
      filters: graphFilters,
      pagination: { take: 500 },
    })

    // Apply text search filter in memory
    let filtered = products
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter((p: any) =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q) ||
        (p.handle || "").toLowerCase().includes(q)
      )
    }

    // Apply category filter
    if (category) {
      const catName = category.toLowerCase()
      filtered = filtered.filter((p: any) =>
        (p.categories || []).some((c: any) => c.name.toLowerCase() === catName)
      )
    }

    // Apply price filters (minor units / cents)
    if (minPrice != null || maxPrice != null) {
      filtered = filtered.filter((p: any) => {
        const prices = (p.variants || []).flatMap((v: any) =>
          (v.prices || [])
            .filter((pr: any) => pr.currency_code === "eur")
            .map((pr: any) => pr.amount)
        )
        if (prices.length === 0) return true
        const minProductPrice = Math.min(...prices)
        if (minPrice != null && minProductPrice < minPrice) return false
        if (maxPrice != null && minProductPrice > maxPrice) return false
        return true
      })
    }

    // Paginate filtered results
    const total = filtered.length
    const paged = filtered.slice(skip, skip + take)
    const products_formatted = paged.map((p: any) => agenticCommerceService.formatUcpProduct(p))

    res.json({
      ucp: { version: UCP_VERSION, status: "success" },
      products: products_formatted,
      pagination: {
        total,
        limit: take,
        offset: skip,
        has_more: skip + take < total,
      },
    })
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}
