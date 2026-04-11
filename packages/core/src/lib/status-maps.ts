/**
 * Protocol-specific status enum mapping.
 * Maps from Medusa cart state to each protocol's required status values.
 */

// --- ACP Status ---
// Spec values: incomplete, not_ready_for_payment, ready_for_payment, completed, canceled

export function resolveAcpStatus(cart: any): string {
  // Canceled (via metadata flag)
  if (cart.metadata?.checkout_session_canceled) return "canceled"
  // Completed
  if (cart.completed_at) return "completed"
  // Payment authorized -> still ready_for_payment in ACP terms
  if (cart.payment_collection?.status === "authorized") return "ready_for_payment"
  // Has shipping + address -> ready
  if (cart.shipping_methods?.length > 0 && cart.shipping_address) return "ready_for_payment"
  // Has items but missing requirements
  if (cart.items?.length > 0) return "not_ready_for_payment"
  // Empty cart
  return "incomplete"
}

// --- UCP Status ---
// Spec values: incomplete, ready_for_complete, completed, canceled

export function resolveUcpStatus(cart: any): string {
  if (cart.metadata?.checkout_session_canceled) return "canceled"
  if (cart.completed_at) return "completed"
  if (cart.payment_collection?.status === "authorized") return "ready_for_complete"
  if (cart.shipping_methods?.length > 0 && cart.shipping_address) return "ready_for_complete"
  return "incomplete"
}
