import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { agentSessions } from "../../lib/agent-session"

export const cancelAgentSessionStep = createStep(
  "cancel-agent-session",
  async (input: { cart_id: string }, { container }) => {
    await agentSessions(container).cancel(input.cart_id)
    return new StepResponse({ cart_id: input.cart_id })
  }
)
