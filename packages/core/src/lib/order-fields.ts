/**
 * Shared order field constants for query.graph calls.
 * Used by order retrieval endpoints for both ACP and UCP.
 */
export const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
  "fulfillment_status",
  "email",
  "currency_code",
  "created_at",
  "updated_at",
  "metadata",
  "items.*",
  "items.variant.*",
  "items.variant.product.*",
  "shipping_address.*",
  "billing_address.*",
  "shipping_methods.*",
  "total",
  "subtotal",
  "tax_total",
  "shipping_total",
  "discount_total",
]

/**
 * Fields for querying fulfillments linked to an order.
 * Fulfillments are a separate module in Medusa v2 — not a direct
 * relation on the order entity. Query via the order_id link.
 */
export const FULFILLMENT_FIELDS = [
  "id",
  "created_at",
  "shipped_at",
  "delivered_at",
  "canceled_at",
  "items.*",
  "labels.tracking_number",
  "labels.tracking_url",
  "provider.id",
]
