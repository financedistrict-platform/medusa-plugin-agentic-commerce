import { CHECKOUT_SESSION_CART_FIELDS } from "./cart-fields"

export const AGENT_SESSION_MODULE = "agenticCommerceSession"

export type AgentSessionRecord = {
  cart_id: string
  session_fingerprint: string
  ucp_version: string | null
  canceled_at: string | Date | null
  handler_data: Record<string, unknown> | null
}

export type OpenAgentSessionInput = {
  cartId: string
  fingerprint: string
  ucpVersion?: string | null
}

export interface AgentSessionStore {
  find(cartId: string): Promise<AgentSessionRecord | null>
  open(input: OpenAgentSessionInput): Promise<AgentSessionRecord>
  cancel(cartId: string): Promise<void>
  storeHandlerData(cartId: string, entries: Record<string, unknown | null>): Promise<void>
  discard(cartId: string): Promise<void>
}

type Resolver = { resolve: (name: string) => unknown }

export function agentSessions(scope: Resolver): AgentSessionStore {
  const store = scope.resolve(AGENT_SESSION_MODULE) as AgentSessionStore | undefined
  if (!store) throw new Error(`The ${AGENT_SESSION_MODULE} module is not registered`)
  return store
}

export function requireLoadedSession<T extends { agent_session?: AgentSessionRecord | null }>(cart: T): T {
  if (cart.agent_session === undefined) {
    throw new Error("The cart was not loaded with its agent session; load it with fetchSessionCart")
  }
  return cart
}

export function isCanceled(session: Pick<AgentSessionRecord, "canceled_at"> | null | undefined): boolean {
  return !!session?.canceled_at
}

export function handlerDataOf(session: Pick<AgentSessionRecord, "handler_data"> | null | undefined): Record<string, unknown> {
  return session?.handler_data ?? {}
}

export async function findSessionOfOrder(scope: Resolver, orderId: string): Promise<AgentSessionRecord | null> {
  const query = scope.resolve("query") as { graph(input: unknown): Promise<{ data: { cart_id?: string | null }[] }> }
  const { data: [link] } = await query.graph({ entity: "order_cart", fields: ["cart_id"], filters: { order_id: orderId } })
  return link?.cart_id ? agentSessions(scope).find(link.cart_id) : null
}

export async function fetchSessionCart(
  scope: Resolver,
  cartId: string,
  fields: string[] = CHECKOUT_SESSION_CART_FIELDS,
) {
  const query = scope.resolve("query") as { graph(input: unknown): Promise<{ data: any[] }> }
  const { data: [cart] } = await query.graph({ entity: "cart", fields, filters: { id: cartId } })
  if (!cart) return undefined
  return { ...cart, agent_session: await agentSessions(scope).find(cartId) }
}
