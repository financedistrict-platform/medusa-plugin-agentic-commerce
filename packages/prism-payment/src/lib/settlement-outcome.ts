export type SettlementState = "settled" | "pending" | "review" | "declined"

export const PENDING_REASONS: readonly string[] = ["checkout_settlement_in_progress", "settlement_pending", "unexpected_settle_error"]

export const REVIEW_REASONS: readonly string[] = ["authorization_consumed", "checkout_already_settled", "settlement_unresolved"]

export const DECLINED_REASONS: readonly string[] = [
  "affiliate_residual_overflow",
  "affiliate_settlement_unavailable",
  "authorization_mismatch",
  "balance_check_failed",
  "balance_verification_failed",
  "cashback_outside_campaign_bounds",
  "credential_already_used",
  "insufficient_funds",
  "invalid_amount_below_required",
  "invalid_amount_exceeds_maximum",
  "invalid_amount_format",
  "invalid_amount_zero_or_negative",
  "invalid_authorization_format",
  "invalid_authorization_recipient",
  "invalid_exact_evm_payload_authorization_expired",
  "invalid_exact_evm_payload_authorization_missing_signature",
  "invalid_exact_evm_payload_authorization_not_yet_valid",
  "invalid_exact_evm_payload_authorization_signature",
  "invalid_exact_evm_payload_authorization_time_bounds",
  "invalid_exact_evm_payload_authorization_value",
  "invalid_exact_evm_payload_recipient_mismatch",
  "invalid_payment_accepted_mismatch",
  "invalid_signature",
  "invalid_timestamp_format",
  "invalid_timestamp_order",
  "network_not_found",
  "point_of_service_not_found",
  "quote_mismatch",
  "quote_not_found",
  "risk_threshold_exceeded",
  "sanctions_hit",
  "seller_wallet_not_configured",
  "unauthorized",
  "unsupported_network",
  "unsupported_token",
]

export const DECLINED_PREFIXES: readonly string[] = ["missing_variant_config:", "unknown_network:", "unknown_token:"]

export const HTTP_PENDING_STATUSES: readonly number[] = [408, 409, 429]

export function classifySettleReply(status: number, body: unknown, resumed: boolean): SettlementState {
  const declined: SettlementState = resumed ? "review" : "declined"
  if (status === 0) return "pending"
  if (status >= 400 && status <= 499 && !HTTP_PENDING_STATUSES.includes(status)) return declined
  if (status < 200 || status > 299) return "pending"
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length === 0) return "pending"

  const reply = body as Record<string, unknown>
  if (reply.success === true) {
    return typeof reply.transaction === "string" && reply.transaction.length > 0 ? "settled" : "pending"
  }

  const code = typeof reply.errorReason === "string" ? reply.errorReason.trim() : ""
  if (PENDING_REASONS.includes(code)) return "pending"
  if (REVIEW_REASONS.includes(code)) return "review"
  if (DECLINED_REASONS.includes(code) || DECLINED_PREFIXES.some((prefix) => code.startsWith(prefix))) return declined
  return resumed ? "review" : "pending"
}
