/**
 * Protocol-specific status enum mapping.
 * Maps from Medusa cart state to each protocol's required status values.
 */

// --- ACP Status ---
// Full spec values per schema.agentic_checkout.json:
//   incomplete, not_ready_for_payment, requires_escalation,
//   authentication_required, ready_for_payment, pending_approval,
//   complete_in_progress, completed, canceled, in_progress, expired

export type AcpStatus =
  | "incomplete"
  | "not_ready_for_payment"
  | "requires_escalation"
  | "authentication_required"
  | "ready_for_payment"
  | "pending_approval"
  | "complete_in_progress"
  | "completed"
  | "canceled"
  | "in_progress"
  | "expired"

export type AcpStatusOpts = {
  requiresEscalation?: boolean
  authenticationRequired?: boolean
  pendingApproval?: boolean
  completeInProgress?: boolean
  inProgress?: boolean
  expired?: boolean
}

export function resolveAcpStatus(cart: any, opts?: AcpStatusOpts): AcpStatus {
  if (cart.metadata?.checkout_session_canceled) return "canceled"
  if (cart.completed_at) return "completed"
  if (opts?.expired) return "expired"
  if (opts?.completeInProgress) return "complete_in_progress"
  if (opts?.pendingApproval) return "pending_approval"
  if (opts?.authenticationRequired) return "authentication_required"
  if (opts?.requiresEscalation) return "requires_escalation"
  if (opts?.inProgress) return "in_progress"
  if (cart.payment_collection?.status === "authorized") return "ready_for_payment"
  if (cart.items?.length > 0 && cart.email && cart.shipping_address) return "ready_for_payment"
  if (cart.items?.length > 0) return "not_ready_for_payment"
  return "incomplete"
}

// --- UCP Status ---
// Spec values: incomplete, requires_escalation, ready_for_complete,
//              complete_in_progress, completed, canceled

export type UcpStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled"

export function resolveUcpStatus(
  cart: any,
  opts?: { requiresEscalation?: boolean; completeInProgress?: boolean }
): UcpStatus {
  if (cart.metadata?.checkout_session_canceled) return "canceled"
  if (cart.completed_at) return "completed"
  if (opts?.completeInProgress) return "complete_in_progress"
  if (opts?.requiresEscalation) return "requires_escalation"
  if (cart.payment_collection?.status === "authorized") return "ready_for_complete"
  if (cart.items?.length > 0 && cart.email && cart.shipping_address) return "ready_for_complete"
  return "incomplete"
}

// --- Missing Requirements ---

export type MissingRequirement = "items" | "email" | "shipping_address"

export function resolveMissingRequirements(cart: any): MissingRequirement[] {
  const missing: MissingRequirement[] = []
  if (!cart.items || cart.items.length === 0) missing.push("items")
  if (!cart.email) missing.push("email")
  if (!cart.shipping_address) missing.push("shipping_address")
  return missing
}
