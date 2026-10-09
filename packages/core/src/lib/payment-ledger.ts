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
