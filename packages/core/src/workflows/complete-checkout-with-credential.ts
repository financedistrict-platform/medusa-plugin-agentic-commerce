import type { MedusaContainer } from "@medusajs/framework/types"
import completeCheckoutSessionWorkflow, { type CompleteCheckoutSessionInput, type CompletionPaymentData } from "./complete-checkout-session"
import { withCredentialHandoff } from "../lib/credential-handoff"
import type { AgentPaymentCredential } from "../lib/agent-payment-credential"

export type CheckoutCompletionRequest = Omit<CompleteCheckoutSessionInput, "payment_data"> &
  Pick<CompletionPaymentData, "x402_version" | "handler_id" | "instrument_type">

export function completeCheckoutWithCredential(
  scope: MedusaContainer,
  request: CheckoutCompletionRequest,
  credential: AgentPaymentCredential,
) {
  const { x402_version, handler_id, instrument_type, ...target } = request
  return withCredentialHandoff(credential.secret, () =>
    completeCheckoutSessionWorkflow(scope).run({
      input: {
        ...target,
        payment_data: {
          credential_sha256: credential.credential_sha256,
          signed_summary: credential.signed_summary,
          x402_version,
          handler_id,
          instrument_type,
        },
      },
    }),
  )
}
