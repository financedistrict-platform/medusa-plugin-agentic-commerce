import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { agentSessions } from "../../lib/agent-session"
import { assertAgentCompletion, type CompletingCart } from "../../lib/agent-completion-guard"

completeCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  assertAgentCompletion(await agentSessions(container).find(input.id), new Date(), cart as CompletingCart)
})
