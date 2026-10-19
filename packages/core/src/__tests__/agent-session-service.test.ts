import { describe, it, expect } from "vitest"
import { Utils } from "@medusajs/framework/mikro-orm/core"
import AgentSessionService from "../modules/agent-session/service"
import { Migration20261019120000 } from "../modules/agent-session/migrations/Migration20261019120000"
import type { PendingSettlementRecord } from "../lib/agent-session"

type Row = { id: string; cart_id: string; session_fingerprint: string; ucp_version: string | null; canceled_at: Date | null; handler_data: Record<string, unknown> | null; pending_settlement?: Record<string, unknown> | null }

function serviceOver(rows: Row[]) {
  const service = Object.create(AgentSessionService.prototype) as AgentSessionService & Record<string, unknown>
  service.listAgentSessions = async (filters: { cart_id: string }) => rows.filter((row) => row.cart_id === filters.cart_id)
  service.createAgentSessions = async (data: Omit<Row, "id" | "canceled_at">) => {
    const row = { id: `agsess_${rows.length + 1}`, canceled_at: null, ...data }
    rows.push(row)
    return row
  }
  service.updateAgentSessions = async (data: Partial<Row> & { id: string }) => {
    const stored = rows.find((row) => row.id === data.id)! as Record<string, unknown>
    for (const [key, value] of Object.entries(data)) {
      stored[key] = Utils.isPlainObject(stored[key]) && Utils.isPlainObject(value) ? Utils.merge({}, stored[key], value) : value
    }
  }
  service.deleteAgentSessions = async (id: string) => {
    rows.splice(rows.findIndex((row) => row.id === id), 1)
  }
  return service
}

const row = (overrides: Partial<Row> = {}): Row => ({
  id: "agsess_0",
  cart_id: "cart_1",
  session_fingerprint: "fp",
  ucp_version: null,
  canceled_at: null,
  handler_data: {},
  ...overrides,
})

describe("AgentSessionService", () => {
  it("opens a session owned by the caller's fingerprint", async () => {
    const rows: Row[] = []
    const service = serviceOver(rows)

    await service.open({ cartId: "cart_1", fingerprint: "fp", ucpVersion: "2026-08-25" })

    expect(await service.find("cart_1")).toMatchObject({ session_fingerprint: "fp", ucp_version: "2026-08-25", canceled_at: null, handler_data: {} })
    expect(await service.find("cart_2")).toBeNull()
  })

  it("records a cancellation once", async () => {
    const rows = [row()]
    const service = serviceOver(rows)

    await service.cancel("cart_1")
    const firstCancel = rows[0].canceled_at
    await service.cancel("cart_1")

    expect(firstCancel).toBeInstanceOf(Date)
    expect(rows[0].canceled_at).toBe(firstCancel)
  })

  it("refuses to cancel or store handler data for a cart without a session", async () => {
    const service = serviceOver([])

    await expect(service.cancel("cart_1")).rejects.toThrow("No agent session exists for cart cart_1")
    await expect(service.storeHandlerData("cart_1", { handler: {} })).rejects.toThrow("No agent session exists for cart cart_1")
  })

  it("keeps the data of other handlers when one handler stores its quote", async () => {
    const rows = [row({ handler_data: { other: { kept: true } } })]
    const service = serviceOver(rows)

    await service.storeHandlerData("cart_1", { prism: { quote: 1 }, third: { t: 1 } })
    await service.storeHandlerData("cart_1", { prism: null })

    expect(rows[0].handler_data).toEqual({ other: { kept: true }, prism: null, third: { t: 1 } })
  })

  it("discards a session and ignores a cart that has none", async () => {
    const rows = [row()]
    const service = serviceOver(rows)

    await service.discard("cart_2")
    await service.discard("cart_1")

    expect(rows).toEqual([])
  })
})

describe("agent session pending settlement", () => {
  const marker = (overrides: Partial<PendingSettlementRecord> = {}): PendingSettlementRecord => ({
    state: "settling",
    credential_sha256: "d1",
    resumed: false,
    started_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
    ...overrides,
  })

  it("adds the pending settlement and agent webhook columns and drops them again", async () => {
    const up: string[] = []
    const down: string[] = []
    const migration = Object.create(Migration20261019120000.prototype) as Migration20261019120000 & { addSql: (sql: string) => void }

    migration.addSql = (sql: string) => { up.push(sql) }
    await migration.up()
    migration.addSql = (sql: string) => { down.push(sql) }
    await migration.down()

    expect(up).toEqual([
      'alter table "agent_session" add column if not exists "pending_settlement" jsonb null;',
      'alter table "agent_session" add column if not exists "agent_webhook_url" text null;',
    ])
    expect(down).toEqual([
      'alter table "agent_session" drop column if exists "pending_settlement";',
      'alter table "agent_session" drop column if exists "agent_webhook_url";',
    ])
  })

  it("stores a settlement marker and clears it again", async () => {
    const rows = [row()]
    const service = serviceOver(rows)

    await service.setPendingSettlement("cart_1", marker())
    expect((await service.find("cart_1"))?.pending_settlement).toMatchObject({ state: "settling", credential_sha256: "d1" })

    await service.setPendingSettlement("cart_1", null)
    expect((await service.find("cart_1"))?.pending_settlement).toBeNull()
  })

  it("keeps a stored transaction when a later write carries none", async () => {
    const rows = [row()]
    const service = serviceOver(rows)

    await service.setPendingSettlement("cart_1", marker({ state: "pending", transaction: "0xaa", reason: "settlement_pending" }))
    await service.setPendingSettlement("cart_1", marker({ state: "pending" }))

    expect((await service.find("cart_1"))?.pending_settlement).toMatchObject({ state: "pending", transaction: "0xaa" })
  })

  it("does not keep a stale reason from an earlier write", async () => {
    const rows = [row()]
    const service = serviceOver(rows)

    await service.setPendingSettlement("cart_1", marker({ state: "pending", reason: "settlement_pending" }))
    await service.setPendingSettlement("cart_1", marker({ state: "settling", resumed: true }))

    expect((await service.find("cart_1"))?.pending_settlement).toMatchObject({ state: "settling", resumed: true, reason: null })
  })

  it("refuses to store a marker for a cart without a session", async () => {
    await expect(serviceOver([]).setPendingSettlement("cart_1", marker())).rejects.toThrow("No agent session exists for cart cart_1")
  })
})
