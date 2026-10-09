import type { AgentSessionRecord, AgentSessionStore } from "../../lib/agent-session"

export type SessionSeed = Partial<AgentSessionRecord> & { cart_id: string }

export function sessionRecord(seed: SessionSeed): AgentSessionRecord {
  return {
    session_fingerprint: "fingerprint",
    ucp_version: null,
    canceled_at: null,
    handler_data: {},
    ...seed,
  }
}

export function fakeAgentSessions(seeds: SessionSeed[] = []) {
  const rows = new Map(seeds.map((seed) => [seed.cart_id, sessionRecord(seed)]))
  const store: AgentSessionStore & { rows: Map<string, AgentSessionRecord> } = {
    rows,
    async find(cartId) {
      return rows.get(cartId) ?? null
    },
    async open({ cartId, fingerprint, ucpVersion }) {
      if (rows.has(cartId)) throw new Error(`session ${cartId} already exists`)
      const record = sessionRecord({ cart_id: cartId, session_fingerprint: fingerprint, ucp_version: ucpVersion ?? null })
      rows.set(cartId, record)
      return record
    },
    async cancel(cartId) {
      const row = rows.get(cartId)
      if (!row) throw new Error(`session ${cartId} not found`)
      rows.set(cartId, { ...row, canceled_at: row.canceled_at ?? new Date().toISOString() })
    },
    async storeHandlerData(cartId, entries) {
      const row = rows.get(cartId)
      if (!row) throw new Error(`session ${cartId} not found`)
      rows.set(cartId, { ...row, handler_data: { ...(row.handler_data ?? {}), ...entries } })
    },
    async discard(cartId) {
      rows.delete(cartId)
    },
  }
  return store
}
