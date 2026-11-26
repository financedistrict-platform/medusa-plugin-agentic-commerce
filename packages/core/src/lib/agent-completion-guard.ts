import { MedusaError } from "@medusajs/framework/utils"
import { isCanceled, type AgentSessionRecord } from "./agent-session"
import { CART_LOCK_TTL_SECONDS } from "../workflows/complete-checkout-session"
import { isPrismProvider } from "./ucp-complete-guard"

export const AGENT_CHECKOUT_REQUIRED = "agent_checkout_required"

export class AgentCheckoutRequiredError extends MedusaError {
  constructor(message: string) {
    super(MedusaError.Types.NOT_ALLOWED, message, AGENT_CHECKOUT_REQUIRED)
  }
}

function isFreshSettlingMarker(session: AgentSessionRecord, now: Date): boolean {
  const marker = session.pending_settlement
  if (marker?.state !== "settling") return false
  const startedAt = Date.parse(marker.started_at)
  if (Number.isNaN(startedAt)) return false
  return now.getTime() - startedAt <= CART_LOCK_TTL_SECONDS * 1000
}

export type CompletingCart = {
  id?: string
  payment_collection?: { payment_sessions?: Array<{ provider_id?: string | null } | null> | null } | null
}

function hasPrismPaymentSession(cart: CompletingCart | null | undefined): boolean {
  return (cart?.payment_collection?.payment_sessions ?? []).some(
    (paymentSession) => typeof paymentSession?.provider_id === "string" && isPrismProvider(paymentSession.provider_id),
  )
}

export function assertAgentCompletion(
  session: AgentSessionRecord | null | undefined,
  now: Date,
  cart?: CompletingCart | null,
): void {
  if (!session) {
    if (hasPrismPaymentSession(cart)) {
      throw new AgentCheckoutRequiredError(`Cart ${cart?.id ?? ""} is paid through the agent checkout; complete it through the agent checkout`)
    }
    return
  }
  if (isCanceled(session)) {
    throw new AgentCheckoutRequiredError(`The agent checkout session of cart ${session.cart_id} is canceled and cannot be completed`)
  }
  if (!isFreshSettlingMarker(session, now)) {
    throw new AgentCheckoutRequiredError(`Cart ${session.cart_id} belongs to an agent checkout session; complete it through the agent checkout`)
  }
}
