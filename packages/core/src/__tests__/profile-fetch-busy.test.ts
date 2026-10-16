import type { AddressInfo } from "node:net"
import type http from "node:http"
import express from "express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const lookups: { url: string; client?: string }[] = []

vi.mock("../lib/agent-profile-fetcher", () => ({
  createAgentProfileFetcher: () => ({
    lookup: async (url: string, client?: string) => {
      lookups.push({ url, client })
      return { status: "busy" }
    },
  }),
}))

import middlewares from "../api/middlewares"
import AgenticCommerceService from "../modules/agentic-commerce/service"
import { fakeAgentSessions } from "./helpers/agent-session-store"

type Middleware = (req: any, res: any, next: () => void) => unknown
type Route = { matcher: string; method?: string; middlewares: Middleware[] }

const routes = (middlewares as any).routes as Route[]

const SESSION_CHAIN = ["validateUcpRequest", "resolveUcpVersionMiddleware", "enforceSessionVersionPin"]

const PROFILE = "https://agent.example/.well-known/ucp"

let server: http.Server | undefined

function pinEnforcedPaths(): string[] {
  return routes
    .filter((route) => route.middlewares.some((m) => m.name === "enforceSessionVersionPin"))
    .map((route) => route.matcher.replace(":id", "cart_1"))
}

async function listen(pinnedVersion: string | null, negotiation: string): Promise<string> {
  const service = new AgenticCommerceService({}, {
    payment_provider_id: "pp_prism_prism",
    ucp_version: "2026-08-25",
    ucp_version_negotiation: negotiation,
  })
  const services: Record<string, unknown> = {
    agenticCommerce: service,
    logger: { warn: () => undefined },
    agenticCommerceSession: fakeAgentSessions([{ cart_id: "cart_1", ucp_version: pinnedVersion }]),
  }
  const app = express()
  app.set("trust proxy", true)
  app.use((req: any, _res: any, next: () => void) => {
    req.scope = { resolve: (name: string) => services[name] }
    next()
  })
  for (const route of routes) {
    const chain = route.middlewares.filter((m) => SESSION_CHAIN.includes(m.name))
    if (chain.length === 0) continue
    if (route.method) (app as any)[route.method.toLowerCase()](route.matcher, ...chain)
    else app.use(route.matcher, ...chain)
  }
  app.use((req: any, res: any) => {
    res.status(200).json({ reached: true, version: req.ucp?.version, outcome: req.ucp?.outcome })
  })
  server = await new Promise<http.Server>((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started))
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function call(base: string, path: string, method = "GET") {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      "ucp-agent": `agent/1.0; profile="${PROFILE}"`,
      "request-id": "req_1",
      "x-forwarded-for": "203.0.113.7",
    },
  })
}

beforeEach(() => {
  lookups.length = 0
})

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

describe("strict negotiation while the agent profile fetcher is busy", () => {
  it("hands the request ip to the fetcher as the client", async () => {
    const base = await listen(null, "strict")
    await call(base, "/ucp/checkout-sessions", "POST")
    expect(lookups).toEqual([{ url: PROFILE, client: "203.0.113.7" }])
  })

  it("answers 503 with Retry-After on a route that has no session pin", async () => {
    const base = await listen(null, "strict")
    const response = await call(base, "/ucp/checkout-sessions", "POST")
    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("3")
    expect(await response.json()).toMatchObject({ messages: [{ code: "profile_fetch_busy" }] })
  })

  it.each(pinEnforcedPaths())("keeps a pinned session working on %s in its pinned version", async (path) => {
    const base = await listen("2026-04-08", "strict")
    const response = await call(base, path, path.endsWith("/complete") || path.endsWith("/cancel") ? "POST" : "GET")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reached: true, version: "2026-04-08", outcome: "busy" })
  })

  it.each(pinEnforcedPaths())("answers 503 with Retry-After on %s when the session has no pin", async (path) => {
    const base = await listen(null, "strict")
    const response = await call(base, path, path.endsWith("/complete") || path.endsWith("/cancel") ? "POST" : "GET")
    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("3")
  })

  it("serves the current version under lenient negotiation", async () => {
    const base = await listen(null, "lenient")
    const response = await call(base, "/ucp/checkout-sessions", "POST")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reached: true, version: "2026-08-25", outcome: "busy" })
  })
})
