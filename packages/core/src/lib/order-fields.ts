/**
 * Shared order field constants for query.graph calls.
 * Used by order retrieval endpoints for both ACP and UCP.
 */
export const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
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
