import { MedusaService } from "@medusajs/framework/utils"
import AgentSession from "./models/agent-session"
import PaymentAuthorization from "./models/payment-authorization"
import type { AgentSessionRecord, AgentSessionStore, OpenAgentSessionInput } from "../../lib/agent-session"
import type { AuthorizationUse, PaymentLedgerStore } from "../../lib/payment-ledger"

type StoredRow = AgentSessionRecord & { id: string }

type AuthorizationKey = { asset: string; payer: string; nonce: string }

type StoredAuthorization = AuthorizationKey & { id: string; cart_id: string }

class AgentSessionService extends MedusaService({ AgentSession, PaymentAuthorization }) implements AgentSessionStore, PaymentLedgerStore {
  async reserve({ asset, payer, nonce, cartId }: AuthorizationUse): Promise<boolean> {
    const key = { asset: asset.toLowerCase(), payer: payer.toLowerCase(), nonce: nonce.toLowerCase() }
    const held = await this.holderOf(key)
    if (held) return held.cart_id === cartId

    try {
      await this.createPaymentAuthorizations({ ...key, cart_id: cartId })
      return true
    } catch (error: unknown) {
      const raced = await this.holderOf(key)
      if (raced) return raced.cart_id === cartId
      throw error
    }
  }

  async find(cartId: string): Promise<AgentSessionRecord | null> {
    const [row] = (await this.listAgentSessions({ cart_id: cartId }, { take: 1 })) as StoredRow[]
    return row ?? null
  }

  async open({ cartId, fingerprint, ucpVersion }: OpenAgentSessionInput): Promise<AgentSessionRecord> {
    return (await this.createAgentSessions({
      cart_id: cartId,
      session_fingerprint: fingerprint,
      ucp_version: ucpVersion ?? null,
      handler_data: {},
    })) as StoredRow
  }

  async cancel(cartId: string): Promise<void> {
    const row = await this.requireRow(cartId)
    if (row.canceled_at) return
    await this.updateAgentSessions({ id: row.id, canceled_at: new Date() })
  }

  async storeHandlerData(cartId: string, entries: Record<string, unknown | null>): Promise<void> {
    const row = await this.requireRow(cartId)
    await this.updateAgentSessions({
      id: row.id,
      handler_data: { ...(row.handler_data ?? {}), ...entries },
    })
  }

  async discard(cartId: string): Promise<void> {
    const [row] = (await this.listAgentSessions({ cart_id: cartId }, { take: 1 })) as StoredRow[]
    if (row) await this.deleteAgentSessions(row.id)
  }

  private async holderOf(key: AuthorizationKey): Promise<StoredAuthorization | undefined> {
    const [row] = (await this.listPaymentAuthorizations(key, { take: 1, withDeleted: true })) as StoredAuthorization[]
    return row
  }

  private async requireRow(cartId: string): Promise<StoredRow> {
    const [row] = (await this.listAgentSessions({ cart_id: cartId }, { take: 1 })) as StoredRow[]
    if (!row) throw new Error(`No agent session exists for cart ${cartId}`)
    return row
  }
}

export default AgentSessionService
