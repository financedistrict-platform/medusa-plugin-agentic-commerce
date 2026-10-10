import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { agentSessions } from "../../lib/agent-session"

type OpenAgentSessionInput = {
  cart_id: string
  fingerprint: string
  ucp_version?: string
}

export const openAgentSessionStep = createStep(
  "open-agent-session",
  async (input: OpenAgentSessionInput, { container }) => {
    await agentSessions(container).open({
      cartId: input.cart_id,
      fingerprint: input.fingerprint,
      ucpVersion: input.ucp_version,
    })
    return new StepResponse({ cart_id: input.cart_id }, input.cart_id)
  },
  async (cartId, { container }) => {
    if (cartId) await agentSessions(container).discard(cartId)
  }
)
