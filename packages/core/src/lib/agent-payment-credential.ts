import { credentialSha256 } from "./credential-digest"
import { Redacted } from "./credential-handoff"
import { extractSignedSummary, type SignedPaymentSummary } from "./validate-signed-amount"

export type AgentPaymentCredential = {
  secret: Redacted<string>
  credential_sha256: string
  signed_summary: SignedPaymentSummary | null
}

export function agentPaymentCredential(raw: string): AgentPaymentCredential {
  return {
    secret: new Redacted(raw),
    credential_sha256: credentialSha256(raw),
    signed_summary: extractSignedSummary(raw),
  }
}
