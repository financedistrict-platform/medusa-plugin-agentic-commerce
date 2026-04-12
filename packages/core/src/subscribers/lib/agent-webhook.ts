/**
 * Shared utility for sending agent webhook notifications from subscribers.
 *
 * Resolves order → cart → metadata.agent_webhook_url, sends the webhook,
 * and logs the delivery result to cart metadata.
 */

type SendAgentWebhookParams = {
  container: { resolve: (name: string) => unknown }
  orderId?: string
  cartId?: string
  eventType: string
  buildPayload: (order: any, cart: any) => Record<string, unknown>
}

export async function sendAgentWebhook(params: SendAgentWebhookParams): Promise<void> {
  const { container, eventType, buildPayload } = params
  const query = container.resolve("query") as any
  const agenticCommerce = container.resolve("agenticCommerce") as any

  // 1. Resolve order if we have an orderId
  let order: any = null
  if (params.orderId) {
    try {
      const { data: [result] } = await query.graph({
        entity: "order",
        fields: ["id", "display_id", "status", "cart_id", "fulfillment_status"],
        filters: { id: params.orderId },
      })
      order = result
    } catch (error: any) {
      console.error(`[agent-webhook] Failed to fetch order ${params.orderId}:`, error.message)
      return
    }
  }

  // 2. Resolve cart from order or direct cartId
  const cartId = params.cartId || order?.cart_id
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
    console.warn(`[agent-webhook] Failed to fetch cart ${cartId}:`, error.message)
    return
  }

  // 3. Check for webhook URL — bail if not an agent order
  const webhookUrl = cart?.metadata?.agent_webhook_url
  if (!webhookUrl) return

  // 4. Build payload via callback
  const payload = buildPayload(order, cart)

  // 5. Send webhook with retry
  const result = await agenticCommerce.sendWebhookEvent({
    url: webhookUrl,
    event_type: eventType,
    payload,
  })

  console.log(
    `[agent-webhook] ${eventType} → ${webhookUrl} (status: ${result.status}, success: ${result.success})`
  )

  // 6. Log delivery to cart metadata
  try {
    const cartModuleService = container.resolve("cart") as any
    const existingLog = cart.metadata?.agent_webhook_log || []
    await cartModuleService.updateCarts(cartId, {
      metadata: {
        ...cart.metadata,
        agent_webhook_log: [
          ...existingLog.slice(-19), // Keep last 20 entries max
          {
            event: eventType,
            status: result.status,
            success: result.success,
            sent_at: new Date().toISOString(),
          },
        ],
      },
    })
  } catch (error: any) {
    console.warn(`[agent-webhook] Failed to log webhook delivery:`, error.message)
  }
}
