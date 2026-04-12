import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendAgentWebhook } from "./lib/agent-webhook"

export default async function orderCanceledWebhookHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  if (!orderId) return

  const agenticCommerce = container.resolve("agenticCommerce") as any
  const storefrontUrl = agenticCommerce.getStorefrontUrl()

  await sendAgentWebhook({
    container,
    orderId,
    eventType: "order_cancel",
    buildPayload: (order, cart) => ({
      type: "order",
      checkout_session_id: cart.id,
      order_id: order.id,
      permalink_url: `${storefrontUrl}/orders/${order.id}`,
      status: "canceled",
    }),
  })
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
