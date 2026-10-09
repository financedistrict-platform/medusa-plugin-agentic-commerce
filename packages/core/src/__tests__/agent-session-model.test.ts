import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import AgentSession from "../modules/agent-session/models/agent-session"

type Field = { nullable: boolean; indexes: { type: string }[]; dataType: { name: string } }

const MODULE = join(__dirname, "..", "modules", "agent-session")
const migration = readFileSync(join(MODULE, "migrations", "Migration20261009120000.ts"), "utf8")
const createTable = /create table if not exists "agent_session" \((.*?), constraint/.exec(migration)?.[1] ?? ""

const SQL_TYPES: Record<string, string> = { id: "text", text: "text", dateTime: "timestamptz", json: "jsonb" }

function migratedColumns() {
  return Object.fromEntries(
    [...createTable.matchAll(/"(\w+)" (\w+) (not null|null)/g)].map(([, name, type, nullability]) => [name, { type, nullable: nullability === "null" }]),
  )
}

describe("agent_session table", () => {
  const schema = (AgentSession as unknown as { schema: Record<string, { parse(name: string): Field }> }).schema
  const modelFields = Object.fromEntries(Object.entries(schema).map(([name, field]) => [name, field.parse(name)]))

  it("is created by the shipped migration with the columns of the model", () => {
    const migrated = migratedColumns()
    const expected = Object.fromEntries(
      Object.entries(modelFields).map(([name, field]) => [name, { type: SQL_TYPES[field.dataType.name], nullable: field.nullable }]),
    )
    expect(migrated).toMatchObject(expected)
    expect(Object.keys(migrated).sort()).toEqual(Object.keys(expected).sort())
  })

  it("holds one session per cart", () => {
    expect(modelFields.cart_id.indexes).toEqual([{ type: "unique" }])
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_agent_session_cart_id_unique" ON "agent_session" ("cart_id")')
  })

  it("keeps the fingerprint mandatory so a session always has an owner", () => {
    expect(modelFields.session_fingerprint.nullable).toBe(false)
  })
})
