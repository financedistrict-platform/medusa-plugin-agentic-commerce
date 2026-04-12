import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/agentic-commerce/cart-metadata/:id
 *
 * Returns cart metadata for the admin widget. Protected by Medusa's
 * admin auth middleware (all /admin/* routes require authentication).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const query = req.scope.resolve("query") as any

  try {
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: ["id", "metadata"],
      filters: { id },
    })

    if (!cart) {
      res.status(404).json({ message: "Cart not found" })
      return
    }

    res.json({ metadata: cart.metadata || {} })
  } catch {
    res.status(500).json({ message: "Failed to fetch cart metadata" })
  }
}
