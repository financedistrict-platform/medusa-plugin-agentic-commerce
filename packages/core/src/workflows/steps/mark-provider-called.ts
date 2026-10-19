import { agentSessions } from "../../lib/agent-session"

type Resolver = { resolve: (name: string) => unknown }

export async function markProviderCalled(cartId: string, container: Resolver, now: Date = new Date()): Promise<void> {
  const sessions = agentSessions(container)
  const marker = (await sessions.find(cartId))?.pending_settlement
  if (!marker) return
  const at = now.toISOString()
  await sessions.setPendingSettlement(cartId, { ...marker, provider_called_at: at, updated_at: at })
}
