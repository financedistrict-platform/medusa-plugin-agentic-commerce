import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import AgentSessionService from "../modules/agent-session/service"
import PaymentAuthorization from "../modules/agent-session/models/payment-authorization"

type Row = { id: string; asset: string; payer: string; nonce: string; cart_id: string }

const UNIQUE_VIOLATION = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" })

function serviceOver(rows: Row[], options: { raceWith?: Row } = {}) {
  const service = Object.create(AgentSessionService.prototype) as AgentSessionService & Record<string, unknown>
  service.listPaymentAuthorizations = async (filters: Partial<Row>) =>
    rows.filter((row) => row.asset === filters.asset && row.payer === filters.payer && row.nonce === filters.nonce)
  service.createPaymentAuthorizations = async (data: Omit<Row, "id">) => {
    if (options.raceWith) {
      rows.push(options.raceWith)
      throw UNIQUE_VIOLATION
    }
    if (rows.some((row) => row.asset === data.asset && row.payer === data.payer && row.nonce === data.nonce)) throw UNIQUE_VIOLATION
    const row = { id: `payauth_${rows.length + 1}`, ...data }
    rows.push(row)
    return row
  }
  return service
}

const use = (overrides: Record<string, string> = {}) => ({
  asset: "0xAsset",
  payer: "0xPayer",
  nonce: `0x${"AB".repeat(32)}`,
  cartId: "cart_1",
  ...overrides,
})

describe("AgentSessionService payment ledger", () => {
  it("binds an authorization to the first cart that presents it", async () => {
    const rows: Row[] = []

    expect(await serviceOver(rows).reserve(use())).toBe(true)

    expect(rows).toEqual([{ id: "payauth_1", asset: "0xasset", payer: "0xpayer", nonce: `0x${"ab".repeat(32)}`, cart_id: "cart_1" }])
  })

  it("accepts the same authorization again on the cart that already holds it", async () => {
    const rows: Row[] = []
    const service = serviceOver(rows)

    await service.reserve(use())

    expect(await service.reserve(use())).toBe(true)
    expect(rows).toHaveLength(1)
  })

  it("refuses the same authorization on another cart", async () => {
    const service = serviceOver([])

    await service.reserve(use())

    expect(await service.reserve(use({ cartId: "cart_2" }))).toBe(false)
  })

  it.each([
    ["the letter case of the token", { asset: "0xASSET" }],
    ["the letter case of the payer", { payer: "0xPAYER" }],
    ["the letter case of the nonce", { nonce: `0x${"aB".repeat(32)}` }],
  ])("sees through %s", async (_label, change) => {
    const service = serviceOver([])

    await service.reserve(use())

    expect(await service.reserve(use({ ...change, cartId: "cart_2" }))).toBe(false)
  })

  it.each([
    ["another token", { asset: "0xOther" }],
    ["another payer", { payer: "0xOther" }],
    ["another nonce", { nonce: `0x${"cd".repeat(32)}` }],
  ])("lets %s bind to another cart", async (_label, change) => {
    const service = serviceOver([])

    await service.reserve(use())

    expect(await service.reserve(use({ ...change, cartId: "cart_2" }))).toBe(true)
  })

  it("decides by the stored row when two carts present the same authorization at once", async () => {
    const racer: Row = { id: "payauth_9", asset: "0xasset", payer: "0xpayer", nonce: `0x${"ab".repeat(32)}`, cart_id: "cart_2" }

    expect(await serviceOver([], { raceWith: racer }).reserve(use())).toBe(false)
    expect(await serviceOver([], { raceWith: { ...racer, cart_id: "cart_1" } }).reserve(use())).toBe(true)
  })

  it("does not hide a write failure that left no row behind", async () => {
    const service = serviceOver([])
    service.createPaymentAuthorizations = async () => {
      throw new Error("connection lost")
    }

    await expect(service.reserve(use())).rejects.toThrow("connection lost")
  })
})

type Field = { nullable: boolean; dataType: { name: string } }

const MODULE = join(__dirname, "..", "modules", "agent-session")
const migration = readFileSync(join(MODULE, "migrations", "Migration20261009130000.ts"), "utf8")
const createTable = /create table if not exists "payment_authorization" \((.*?), constraint/.exec(migration)?.[1] ?? ""

describe("payment_authorization table", () => {
  const schema = (PaymentAuthorization as unknown as { schema: Record<string, { parse(name: string): Field }> }).schema
  const modelFields = Object.fromEntries(Object.entries(schema).map(([name, field]) => [name, field.parse(name)]))

  it("is created by the shipped migration with the columns of the model", () => {
    const migrated = Object.fromEntries(
      [...createTable.matchAll(/"(\w+)" (\w+) (not null|null)/g)].map(([, name, type, nullability]) => [name, { type, nullable: nullability === "null" }]),
    )
    const SQL_TYPES: Record<string, string> = { id: "text", text: "text", dateTime: "timestamptz" }
    const expected = Object.fromEntries(
      Object.entries(modelFields).map(([name, field]) => [name, { type: SQL_TYPES[field.dataType.name], nullable: field.nullable }]),
    )
    expect(migrated).toMatchObject(expected)
    expect(Object.keys(migrated).sort()).toEqual(Object.keys(expected).sort())
  })

  it("holds one row per token, payer and nonce", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_authorization_asset_payer_nonce_unique" ON "payment_authorization" ("asset", "payer", "nonce")',
    )
    const { indexes } = (PaymentAuthorization as unknown as { parse(): { indexes: { on: string[]; unique?: boolean }[] } }).parse()
    expect(indexes).toContainEqual(expect.objectContaining({ on: ["asset", "payer", "nonce"], unique: true }))
  })

  it("keeps every column mandatory so a row always names its cart", () => {
    for (const name of ["asset", "payer", "nonce", "cart_id"]) expect(modelFields[name].nullable).toBe(false)
  })
})
