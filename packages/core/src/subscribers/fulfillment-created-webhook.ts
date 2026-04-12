import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendAgentWebhook } from "./lib/agent-webhook"

/**
 * Fires when a fulfillment is created for an order.
 *
 * Medusa v2 emits `order.fulfillment_created` with { order_id, fulfillment_id }
 * in the event payload. We fetch the fulfillment details separately since
 * it's not directly on the order entity.
 */
export default async function fulfillmentCreatedWebhookHandler({
  event,
  container,
}: SubscriberArgs<{ order_id: string; fulfillment_id: string; no_notification: boolean }>) {
  const { order_id, fulfillment_id } = event.data
  if (!order_id || !fulfillment_id) return

  const query = container.resolve("query") as any

  // Fetch fulfillment details — tracking lives on labels, provider is a relation
  let fulfillment: any
  try {
    const { data: [result] } = await query.graph({
      entity: "fulfillment",
      fields: [
        "id",
        "created_at",
        "shipped_at",
        "items.*",
        "labels.tracking_number",
        "labels.tracking_url",
        "provider.id",
      ],
      filters: { id: fulfillment_id },
    })
    fulfillment = result
  } catch (error: any) {
    console.error(`[fulfillment-webhook] Failed to fetch fulfillment ${fulfillment_id}:`, error.message)
    return
  }

  if (!fulfillment) return

  const trackingNumber = fulfillment.labels?.[0]?.tracking_number || null
  const carrier = fulfillment.provider?.id || null

  await sendAgentWebhook({
    container,
    orderId: order_id,
    eventType: "fulfillment_create",
    buildPayload: (order, cart) => ({
      type: "fulfillment",
      checkout_session_id: cart.id,
      order_id: order.id,
      fulfillment_id: fulfillment.id,
      status: "shipped",
      tracking_number: trackingNumber,
      carrier,
      items: (fulfillment.items || []).map((i: any) => ({
        product_id: i.line_item?.product_id || null,
        variant_id: i.line_item_id || null,
        quantity: i.quantity,
      })),
    }),
  })
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}
