import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { agentSessions } from "../../lib/agent-session"
import { credentialSha256 } from "../../lib/credential-digest"
import {
  PAYMENT_PENDING_MISMATCH,
  PAYMENT_PENDING_MISMATCH_MESSAGE,
  SETTLEMENT_UNDER_REVIEW,
  SETTLEMENT_UNDER_REVIEW_MESSAGE,
} from "../../lib/payment-ledger"

export type GuardPendingSettlementInput = {
  cart_id: string
  payment_data?: { eip3009_authorization?: string }
}

type Resolver = { resolve: (name: string) => unknown }

export function credentialDigestOf(paymentData: GuardPendingSettlementInput["payment_data"]): string | null {
  const credential = paymentData?.eip3009_authorization
  return typeof credential === "string" && credential.length > 0 ? credentialSha256(credential) : null
}

export async function guardPendingSettlement(input: GuardPendingSettlementInput, container: Resolver): Promise<{ resumed: boolean }> {
  const marker = (await agentSessions(container).find(input.cart_id))?.pending_settlement
  if (!marker) return { resumed: false }
  if (marker.state === "review") {
    throw new MedusaError(MedusaError.Types.CONFLICT, SETTLEMENT_UNDER_REVIEW_MESSAGE, SETTLEMENT_UNDER_REVIEW)
  }
  if (credentialDigestOf(input.payment_data) !== marker.credential_sha256) {
    throw new MedusaError(MedusaError.Types.CONFLICT, PAYMENT_PENDING_MISMATCH_MESSAGE, PAYMENT_PENDING_MISMATCH)
  }
  return { resumed: true }
}

export const guardPendingSettlementStep = createStep(
  "guard-pending-settlement",
  async (input: GuardPendingSettlementInput, { container }) => new StepResponse(await guardPendingSettlement(input, container)),
)
