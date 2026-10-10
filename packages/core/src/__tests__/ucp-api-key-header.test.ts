import { describe, it, expect } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import { createIdempotencyMiddleware } from "../api/middleware/idempotency"
import AgenticCommerceService from "../modules/agentic-commerce/service"
import { computeSessionFingerprint } from "../lib/session-ownership"
import { createResponse, findRoute } from "./helpers/render-wire"

const KEY = "store-key-123"
const AGENT = 'profile="https://agent.example/profile.json"'

function service() {
  return new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism", api_key: KEY })
}

async function authenticate(headers: Record<string, string>) {
  const route = findRoute("/ucp/checkout-sessions*")
  const res = createResponse()
  let passed = false
  const req: any = {
    headers: { "ucp-agent": AGENT, "request-id": "req-1", ...headers },
    scope: { resolve: (name: string) => (name === "agenticCommerce" ? service() : undefined) },
  }
  await route.middlewares[0](req, res, () => { passed = true })
  return { res, passed }
}

describe("UCP X-API-Key validation", () => {
  it("lets a valid X-API-Key through", async () => {
    const { passed, res } = await authenticate({ "x-api-key": KEY })
    expect(passed).toBe(true)
    expect(res.statusCode).toBe(200)
  })

  it("rejects an invalid X-API-Key with 401", async () => {
    const { passed, res } = await authenticate({ "x-api-key": "wrong" })
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(401)
  })

  it("rejects a valid Bearer combined with an invalid X-API-Key", async () => {
    const { passed, res } = await authenticate({ authorization: `Bearer ${KEY}`, "x-api-key": "wrong" })
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(401)
  })

  it("keeps accepting a valid Bearer and rejecting an invalid one", async () => {
    expect((await authenticate({ authorization: `Bearer ${KEY}` })).passed).toBe(true)
    const bad = await authenticate({ authorization: "Bearer wrong" })
    expect(bad.passed).toBe(false)
    expect(bad.res.statusCode).toBe(401)
  })

  it("keeps allowing requests with neither header", async () => {
    expect((await authenticate({})).passed).toBe(true)
  })
})

describe("UCP X-API-Key identity", () => {
  async function cacheKeyFor(headers: Record<string, string>) {
    const entries = new Map<string, unknown>()
    const cache = {
      get: async (key: string) => entries.get(key) ?? null,
      set: async (key: string, value: unknown) => { entries.set(key, value) },
      invalidate: async (key: string) => { entries.delete(key) },
    }
    const services: Record<string, unknown> = { [Modules.CACHE]: cache, agenticCommerce: service() }
    const res = createResponse()
    const req: any = {
      method: "POST",
      path: "/ucp/checkout-sessions",
      headers: { "idempotency-key": "idem-1", ...headers },
      body: {},
      scope: { resolve: (name: string) => services[name] },
    }
    await createIdempotencyMiddleware({ required: true, protocol: "ucp" })(req, res as any, () => {
      res.status(201).json({})
    })
    await Promise.resolve()
    return [...entries.keys()][0]
  }

  it("scopes idempotency identically for X-API-Key and Bearer", async () => {
    const viaHeader = await cacheKeyFor({ "x-api-key": KEY })
    const viaBearer = await cacheKeyFor({ authorization: `Bearer ${KEY}` })
    expect(viaHeader).toBeDefined()
    expect(viaHeader).toBe(viaBearer)
  })

  it("scopes idempotency differently for different keys", async () => {
    expect(await cacheKeyFor({ "x-api-key": KEY })).not.toBe(await cacheKeyFor({ "x-api-key": "other" }))
  })

  it("fingerprints a session identically for X-API-Key and Bearer", () => {
    const viaHeader = computeSessionFingerprint("acp", { "x-api-key": KEY })
    expect(viaHeader).not.toBeNull()
    expect(viaHeader).toBe(computeSessionFingerprint("acp", { authorization: `Bearer ${KEY}` }))
  })
})
