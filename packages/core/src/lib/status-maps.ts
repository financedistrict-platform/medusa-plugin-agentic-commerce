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
  // Has items + email + address -> ready (shipping method auto-added by complete flow if missing)
  if (cart.items?.length > 0 && cart.email && cart.shipping_address) return "ready_for_payment"
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
  // Require items + email + shipping_address. The complete endpoint auto-attaches
  // a shipping method if none is present, so we don't require shipping_methods here.
  if (cart.items?.length > 0 && cart.email && cart.shipping_address) return "ready_for_complete"
  return "incomplete"
}

// --- Missing Requirements ---
// Returns the list of things that need to be provided before the session
// can transition to ready_for_complete / ready_for_payment.

export type MissingRequirement = "items" | "email" | "shipping_address"

export function resolveMissingRequirements(cart: any): MissingRequirement[] {
  const missing: MissingRequirement[] = []
  if (!cart.items || cart.items.length === 0) missing.push("items")
  if (!cart.email) missing.push("email")
  if (!cart.shipping_address) missing.push("shipping_address")
  return missing
}
