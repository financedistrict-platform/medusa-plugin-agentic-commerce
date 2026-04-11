import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

/**
 * Subscriber that fires when an order is placed.
 * If the originating cart had an `agent_webhook_url` in metadata
 * (set during checkout session creation), we notify the agent.
 *
 * ACP webhook format:
 * - Event type: order_create / order_update
 * - Data: { checkout_session_id, permalink_url, status, refunds[] }
 * - Timestamp in header, not body
 */
export default async function orderPlacedWebhookHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  if (!orderId) return

  const query = container.resolve("query") as any

  // Fetch the order
  let order: any
  try {
    const { data: [result] } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "status", "cart_id"],
      filters: { id: orderId },
    })
    order = result
  } catch (error: any) {
    console.error(`[order-placed-webhook] Failed to fetch order ${orderId}:`, error.message)
    return
  }

  if (!order) {
    console.warn(`[order-placed-webhook] Order ${orderId} not found`)
    return
  }

  // Look up the original cart to get the webhook URL from metadata
  const cartId = order.cart_id
  if (!cartId) return

  let cart: any
  try {
    const { data: [result] } = await query.graph({
      entity: "cart",
      fields: ["id", "metadata"],
      filters: { id: cartId },
    })
    cart = result
  } catch (error: any) {
    console.warn(`[order-placed-webhook] Failed to fetch cart ${cartId}:`, error.message)
    return
  }

  const webhookUrl = cart?.metadata?.agent_webhook_url
  if (!webhookUrl) {
    // No webhook URL — not an agent order, or no webhook registered
    return
  }

  const agenticCommerceService = container.resolve("agenticCommerce") as any
  const storefrontUrl = agenticCommerceService.getStorefrontUrl()

  try {
    await agenticCommerceService.sendWebhookEvent({
      url: webhookUrl,
      event_type: "order_create",
      payload: {
        type: "order",
        checkout_session_id: cartId,
        permalink_url: `${storefrontUrl}/orders/${order.id}`,
        status: order.status || "created",
        refunds: [],
      },
    })
    console.log(`[order-placed-webhook] Notified agent at ${webhookUrl} for order ${orderId}`)
  } catch (error: any) {
    console.error(`[order-placed-webhook] Failed to notify ${webhookUrl}:`, error.message)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
