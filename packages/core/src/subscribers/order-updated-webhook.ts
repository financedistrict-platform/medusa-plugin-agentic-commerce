import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendAgentWebhook } from "./lib/agent-webhook"

/**
 * Debounce: skip if we sent a webhook for this order < 5 seconds ago.
 * Uses order metadata to track last send time.
 */
export default async function orderUpdatedWebhookHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  if (!orderId) return

  // Debounce check — read order metadata for last webhook timestamp
  const query = container.resolve("query") as any
  let order: any
  try {
    const { data: [result] } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "status", "cart_id", "metadata"],
      filters: { id: orderId },
    })
    order = result
  } catch {
    return
  }
  if (!order) return

  const lastSent = order.metadata?.last_webhook_sent_at
  if (lastSent && Date.now() - new Date(lastSent).getTime() < 5000) {
    return // debounce
  }

  const agenticCommerce = container.resolve("agenticCommerce") as any
  const storefrontUrl = agenticCommerce.getStorefrontUrl()

  await sendAgentWebhook({
    container,
    orderId,
    eventType: "order_update",
    buildPayload: (_order, cart) => ({
      type: "order",
      checkout_session_id: cart.id,
      order_id: order.id,
      permalink_url: `${storefrontUrl}/orders/${order.id}`,
      status: order.status || "pending",
    }),
  })

  // Update debounce timestamp on order metadata
  try {
    const orderModuleService = container.resolve("order") as any
    await orderModuleService.updateOrders(orderId, {
      metadata: {
        ...order.metadata,
        last_webhook_sent_at: new Date().toISOString(),
      },
    })
  } catch {
    // Best effort
  }
}

export const config: SubscriberConfig = {
  event: "order.updated",
}
