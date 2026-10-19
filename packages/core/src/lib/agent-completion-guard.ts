import { MedusaError } from "@medusajs/framework/utils"
import { isCanceled, type AgentSessionRecord } from "./agent-session"
import { CART_LOCK_TTL_SECONDS } from "../workflows/complete-checkout-session"

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

export function assertAgentCompletion(session: AgentSessionRecord | null | undefined, now: Date): void {
  if (!session) return
  if (isCanceled(session)) {
    throw new AgentCheckoutRequiredError(`The agent checkout session of cart ${session.cart_id} is canceled and cannot be completed`)
  }
  if (!isFreshSettlingMarker(session, now)) {
    throw new AgentCheckoutRequiredError(`Cart ${session.cart_id} belongs to an agent checkout session; complete it through the agent checkout`)
  }
}
