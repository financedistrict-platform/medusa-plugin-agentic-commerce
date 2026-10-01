import { describe, it, expect } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import { createIdempotencyMiddleware } from "../api/middleware/idempotency"
import AgenticCommerceService from "../modules/agentic-commerce/service"
import { createUcpVersionRegistry } from "../lib/ucp-version-registry"

const registry = createUcpVersionRegistry()
const CURRENT = registry.current
const COMPAT = registry.supported[0]
const PATH = "/ucp/checkout-sessions"
const BODY = { line_items: [{ item: { id: "variant_1" }, quantity: 1 }] }

function cacheModule() {
  const entries = new Map<string, unknown>()
  return {
    entries,
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: unknown) => { entries.set(key, value) },
    invalidate: async (key: string) => { entries.delete(key) },
  }
}

function harness() {
  const cache = cacheModule()
  const service = new AgenticCommerceService({}, {})
  const services: Record<string, unknown> = { [Modules.CACHE]: cache, agenticCommerce: service }
  const middleware = createIdempotencyMiddleware({ required: true, protocol: "ucp" })
  let executions = 0

  async function send(version: string, key: string) {
    const headers: Record<string, string> = {}
    const res: any = {
      statusCode: 200,
      body: undefined as unknown,
      headers,
      status(code: number) { res.statusCode = code; return res },
      set(name: string, value: string) { headers[name] = value; return res },
      json(body: unknown) { res.body = body; return res },
    }
    const req: any = {
      method: "POST",
      path: PATH,
      headers: { "idempotency-key": key, "ucp-agent": 'profile="https://agent.example/profile.json"' },
      body: BODY,
      ucp: { version, wire: registry.wire(version), outcome: "matched" },
      scope: { resolve: (name: string) => services[name] },
    }
    await middleware(req, res, () => {
      executions++
      res.status(201).json({ ucp: { version }, id: `session_${executions}` })
    })
    await Promise.resolve()
    return res
  }

  return { cache, send, executions: () => executions }
}

describe("UCP idempotency across versions", () => {
  it("answers the same key in another version with that version's own response", async () => {
    const { send, executions } = harness()
    await send(COMPAT, "idem-1")

    const other = await send(CURRENT, "idem-1")

    expect(other.headers["Idempotent-Replayed"]).toBeUndefined()
    expect(other.body).toMatchObject({ ucp: { version: CURRENT } })
    expect(executions()).toBe(2)
  })

  it("still replays the stored body for the same key in the same version", async () => {
    const { send, executions } = harness()
    const first = await send(COMPAT, "idem-2")
    await send(CURRENT, "idem-2")

    const replay = await send(COMPAT, "idem-2")

    expect(replay.headers["Idempotent-Replayed"]).toBe("true")
    expect(replay.body).toEqual(first.body)
    expect(executions()).toBe(2)
  })

  it("keeps the cache key of a current-version caller unchanged", async () => {
    const { cache, send } = harness()
    await send(CURRENT, "idem-3")

    expect([...cache.entries.keys()].filter((key) => key.endsWith(`:${PATH}:idem-3`))).toHaveLength(1)
    expect([...cache.entries.keys()].some((key) => key.includes(CURRENT))).toBe(false)
  })
})
