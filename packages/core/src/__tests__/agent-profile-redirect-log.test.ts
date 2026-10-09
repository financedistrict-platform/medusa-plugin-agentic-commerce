import http from "node:http"
import type { AddressInfo } from "node:net"
import { describe, it, expect, vi } from "vitest"

const lookup = vi.fn()

vi.mock("../lib/agent-profile-fetcher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/agent-profile-fetcher")>()),
  createAgentProfileFetcher: () => ({ lookup }),
}))

const { default: middlewares } = await import("../api/middlewares")
const { default: AgenticCommerceService } = await import("../modules/agentic-commerce/service")

type Middleware = (req: any, res: any, next: () => void) => Promise<void>

function resolveMiddleware(): Middleware {
  const route = (middlewares as any).routes.find((r: any) => r.matcher === "/ucp/checkout-sessions*")
  return route.middlewares.find((m: Middleware) => m.name === "resolveUcpVersionMiddleware")
}

function request(profile = "https://agent.example/.well-known/ucp/2026-08-25/") {
  const service = new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism", store_name: "Demo Store", ucp_version: "2026-04-08" })
  const warnings: string[] = []
  const services: Record<string, unknown> = { agenticCommerce: service, logger: { warn: (m: string) => warnings.push(m) } }
  return {
    req: {
      headers: { "ucp-agent": `agent/1.0; profile="${profile}"` },
      path: "/ucp/checkout-sessions",
      scope: { resolve: (n: string) => services[n] },
    } as any,
    warnings,
  }
}

function capture() {
  const res = { statusCode: 200, body: undefined as any, status(c: number) { res.statusCode = c; return res }, json(b: unknown) { res.body = b; return res } }
  return res
}

describe("agent profile redirect through the version middleware", () => {
  it("answers 424 profile_redirected in lenient mode and logs the location", async () => {
    lookup.mockResolvedValueOnce({ status: "redirected", location: "https://other.example/profile" })
    const { req, warnings } = request()
    const res = capture()
    let nextCalled = false
    await resolveMiddleware()(req, res, () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(424)
    expect(JSON.stringify(res.body)).toContain("profile_redirected")
    expect(JSON.stringify(res.body)).toContain("Agent profile URL redirects to https://other.example/profile; use the final URL.")
    expect(JSON.parse(warnings[0])).toEqual({
      ucp_profile_resolution: "redirected",
      served: null,
      host: "agent.example",
      location: "https://other.example/profile",
    })
  })

  it("keeps userinfo out of the response and the log", async () => {
    const actual = await vi.importActual<typeof import("../lib/agent-profile-fetcher")>("../lib/agent-profile-fetcher")
    const fetcher = actual.createAgentProfileFetcher({ allowLoopbackForTests: true })
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: "https://user:secret@other.example/p" }).end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      lookup.mockImplementationOnce((url: string) => fetcher.lookup(url))
      const { req, warnings } = request(`http://127.0.0.1:${(server.address() as AddressInfo).port}/profile`)
      const res = capture()
      await resolveMiddleware()(req, res, () => undefined)
      expect(res.statusCode).toBe(424)
      expect(JSON.stringify(res.body)).toContain("Agent profile URL redirects to https://other.example/p; use the final URL.")
      expect(JSON.parse(warnings[0]).location).toBe("https://other.example/p")
      for (const text of [JSON.stringify(res.body), warnings[0]]) {
        expect(text).not.toContain("secret")
        expect(text).not.toContain("user@")
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("logs a null location when the redirect carries none", async () => {
    lookup.mockResolvedValueOnce({ status: "redirected", location: null })
    const { req, warnings } = request()
    const res = capture()
    await resolveMiddleware()(req, res, () => undefined)
    expect(res.statusCode).toBe(424)
    expect(JSON.stringify(res.body)).toContain("Agent profile URL redirects; use the final URL.")
    expect(JSON.parse(warnings[0]).location).toBeNull()
  })
})
