import { listShippingOptionsForCartWorkflow } from "@medusajs/medusa/core-flows"

/**
 * List shipping options available for a cart.
 *
 * Used by UCP/ACP checkout session routes to populate the Fulfillment
 * Extension's options array. Returns an empty array if the cart has no
 * shippable address yet, if the region has no shipping profiles, or if the
 * workflow fails (so route handlers can still return a valid response).
 */
export async function listShippingOptionsSafe(
  container: any,
  cart_id: string
): Promise<any[]> {
  try {
    const { result } = await listShippingOptionsForCartWorkflow(container).run({
      input: { cart_id, is_return: false },
    })
    return Array.isArray(result) ? result : []
  } catch {
    // Pre-address carts commonly 400 here; treat as "no options yet".
    return []
  }
}
