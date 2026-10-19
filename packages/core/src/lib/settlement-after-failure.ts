import type { PendingSettlementRecord } from "./agent-session"

export type SettlementAfterFailure =
  | { kind: "clear" }
  | { kind: "pending" | "review"; transaction?: string; reason?: string }

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export type FailedPaymentSession = { status?: string | null; data?: Record<string, unknown> | null }

export function settlementAfterFailure(
  session: FailedPaymentSession | null | undefined,
  marker: Pick<PendingSettlementRecord, "credential_sha256" | "transaction">,
  resumed: boolean,
): SettlementAfterFailure {
  if (!marker.credential_sha256) return { kind: "clear" }

  const sessionData = session?.data
  const state = sessionData?.settlement_state
  if (state === undefined && session?.status === "pending") {
    if (!resumed) return { kind: "clear" }
    const kept = nonEmpty(marker.transaction)
    return { kind: "pending", ...(kept ? { transaction: kept } : {}) }
  }
  if (state === "declined" && !resumed) return { kind: "clear" }

  const kind = state === "pending" || (state === undefined && !resumed) ? "pending" : "review"
  const transaction = nonEmpty(sessionData?.unreconciled_transaction) ?? nonEmpty(sessionData?.prism_tx_id) ?? nonEmpty(marker.transaction)
  const reason = nonEmpty(sessionData?.error_message) ?? nonEmpty(sessionData?.error)
  return { kind, ...(transaction ? { transaction } : {}), ...(reason ? { reason } : {}) }
}
