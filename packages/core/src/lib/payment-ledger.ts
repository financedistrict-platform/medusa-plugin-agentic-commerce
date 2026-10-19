import { AGENT_SESSION_MODULE } from "./agent-session"

export const PAYMENT_AUTHORIZATION_USED = "payment_authorization_used"

export const PAYMENT_AUTHORIZATION_USED_MESSAGE =
  "The payment authorization has already been used for another checkout. Sign a new authorization."

export function isAuthorizationUsed(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === PAYMENT_AUTHORIZATION_USED
}

export type AuthorizationUse = {
  asset: string
  payer: string
  nonce: string
  cartId: string
}

export interface PaymentLedgerStore {
  reserve(use: AuthorizationUse): Promise<boolean>
}

type Resolver = { resolve: (name: string) => unknown }

export function paymentLedger(scope: Resolver): PaymentLedgerStore {
  const store = scope.resolve(AGENT_SESSION_MODULE) as PaymentLedgerStore | undefined
  if (!store) throw new Error(`The ${AGENT_SESSION_MODULE} module is not registered`)
  return store
}

export const PAYMENT_PENDING_MISMATCH = "payment_pending_mismatch"

export const PAYMENT_PENDING_MISMATCH_MESSAGE =
  "A settlement for this checkout is still pending with another payment credential. Retry with the same credential."

export function isPaymentPendingMismatch(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === PAYMENT_PENDING_MISMATCH
}

export const SETTLEMENT_UNDER_REVIEW = "settlement_under_review"

export const SETTLEMENT_UNDER_REVIEW_MESSAGE =
  "The payment for this checkout needs a review by the merchant before the order can be placed."

export function isSettlementUnderReview(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === SETTLEMENT_UNDER_REVIEW
}
