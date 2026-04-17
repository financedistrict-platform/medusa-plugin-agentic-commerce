/**
 * Shared cart field constants for query.graph calls.
 * Used by all checkout session workflows to ensure consistent data loading.
 */
export const CHECKOUT_SESSION_CART_FIELDS = [
  "id",
  "region_id",
  "currency_code",
  "email",
  "completed_at",
  "metadata",
  "subtotal",
  "total",
  "tax_total",
  "shipping_total",
  "discount_total",
  "item_subtotal",
  "item_total",
  "items.*",
  "items.variant.*",
  "items.variant.product.*",
  "shipping_address.*",
  "shipping_methods.*",
  "payment_collection.*",
  "payment_collection.payment_sessions.*",
  // Cart-to-order link — used by the complete route to confirm order creation
  "order.id",
  "order.display_id",
]

/**
 * Minimal cart fields for status checks and validation.
 */
export const CART_VALIDATION_FIELDS = [
  "id",
  "email",
  "completed_at",
  "metadata",
  "items.id",
  "shipping_address.id",
  "shipping_methods.id",
  "payment_collection.id",
  "payment_collection.payment_sessions.*",
]
