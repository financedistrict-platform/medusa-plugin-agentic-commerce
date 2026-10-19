import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { agentSessions } from "../../lib/agent-session"

type Resolver = { resolve: (name: string) => unknown }

export async function clearSettlementAttempt(input: { cart_id: string }, container: Resolver): Promise<void> {
  try {
    await agentSessions(container).setPendingSettlement(input.cart_id, null)
  } catch (error: unknown) {
    console.error(`[agentic-commerce] Could not clear the settlement marker of cart ${input.cart_id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const clearSettlementAttemptStep = createStep(
  "clear-settlement-attempt",
  async (input: { cart_id: string }, { container }) => {
    await clearSettlementAttempt(input, container)
    return new StepResponse({ cart_id: input.cart_id })
  },
)
