import { describe, it, expect } from "vitest"
import middlewares from "../api/middlewares"
import AgenticCommerceService from "../modules/agentic-commerce/service"
import { fakeAgentSessions } from "./helpers/agent-session-store"
import { createUcpVersionRegistry } from "../lib/ucp-version-registry"
import { applyUcpSessionPin, type UcpResolution } from "../lib/ucp-version-resolver"
import { ucpVersionFor, ucpWireFor } from "../lib/ucp-version"

const registry = createUcpVersionRegistry({ ucp_version: "2026-04-08" })

const resolution = (outcome: UcpResolution["outcome"], version: string, declared?: string): UcpResolution => ({
  version,
  wire: registry.wire(version),
  outcome,
  declared,
  host: "agent.example",
})

type Middleware = (req: any, res: any, next: () => void) => Promise<void>

function pinMiddleware(): Middleware {
  const route = (middlewares as any).routes.find((r: any) => r.matcher === "/ucp/checkout-sessions/:id")
  const middleware = route.middlewares.find((m: Middleware) => m.name === "enforceSessionVersionPin")
  if (!middleware) throw new Error("enforceSessionVersionPin is not registered on /ucp/checkout-sessions/:id")
  return middleware
}

function pinRequest(pinnedVersion: string | undefined, ucp: UcpResolution) {
  const service = new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism", ucp_version: "2026-04-08" })
  const warnings: string[] = []
  const services: Record<string, unknown> = {
    agenticCommerce: service,
    logger: { warn: (message: string) => warnings.push(message) },
    agenticCommerceSession: fakeAgentSessions([{ cart_id: "cart_1", ucp_version: pinnedVersion ?? null }]),
  }
  return {
    req: { params: { id: "cart_1" }, ucp, scope: { resolve: (n: string) => services[n] } },
    warnings,
  }
}

function capture() {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { res.statusCode = c; return res }, json(b: unknown) { res.body = b; return res } }
  return res
}

describe("applyUcpSessionPin", () => {
  it("keeps the resolution for a session without a pin", () => {
    const current = resolution("matched", "2026-08-25", "2026-08-25")
    expect(applyUcpSessionPin(registry, current, undefined)).toBe(current)
  })

  it("rejects a matched profile whose version differs from the pinned one", () => {
    const pinned = applyUcpSessionPin(registry, resolution("matched", "2026-04-08", "2026-04-08"), "2026-08-25")
    expect(pinned.rejection).toMatchObject({ status: 422, code: "version_unsupported" })
    expect(pinned.rejection!.content).toBe("This session is bound to UCP version 2026-08-25; the agent profile now declares 2026-04-08.")
  })

  it.each(["unreachable", "undeclared", "none"] as const)("serves the pinned version on a %s outcome", (outcome) => {
    const pinned = applyUcpSessionPin(registry, resolution(outcome, "2026-04-08"), "2026-08-25")
    expect(pinned.rejection).toBeUndefined()
    expect(pinned.version).toBe("2026-08-25")
    expect(pinned.wire.version).toBe("2026-08-25")
  })

  it("ignores a pin that is not a known version", () => {
    const current = resolution("unreachable", "2026-04-08")
    expect(applyUcpSessionPin(registry, current, "1999-01-01")).toBe(current)
  })
})

describe("enforceSessionVersionPin middleware", () => {
  it("serves 2026-08-25 for a session pinned to 2026-08-25 when the profile is unreachable", async () => {
    const { req, warnings } = pinRequest("2026-08-25", resolution("unreachable", "2026-04-08"))
    let nextCalled = false
    await pinMiddleware()(req, capture(), () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(ucpVersionFor(req)).toBe("2026-08-25")
    expect(ucpWireFor(req).version).toBe("2026-08-25")
    expect(JSON.parse(warnings[0])).toEqual({ ucp_profile_resolution: "unreachable", served: "2026-08-25", host: "agent.example" })
  })

  it("answers 422 for a session pinned to 2026-08-25 when the profile declares 2026-04-08", async () => {
    const { req } = pinRequest("2026-08-25", resolution("matched", "2026-04-08", "2026-04-08"))
    const res = capture()
    let nextCalled = false
    await pinMiddleware()(req, res, () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(422)
    expect(res.body).toMatchObject({ ucp: { version: "2026-04-08", status: "error" }, messages: [{ code: "version_unsupported" }] })
  })

  it("never rejects a session created before pinning existed", async () => {
    const { req } = pinRequest(undefined, resolution("matched", "2026-04-08", "2026-04-08"))
    let nextCalled = false
    await pinMiddleware()(req, capture(), () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(ucpVersionFor(req)).toBe("2026-04-08")
  })
})

describe("ucpVersionFor", () => {
  it("fails loudly when the agentic commerce service is missing", () => {
    const req = { scope: { resolve: (name: string) => { throw new Error(`${name} not registered`) } } }
    expect(() => ucpVersionFor(req)).toThrow("agenticCommerce not registered")
  })

  it("falls back to the configured current version before resolution", () => {
    const service = new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism", ucp_version: "2026-08-25" })
    expect(ucpVersionFor({ scope: { resolve: () => service } })).toBe("2026-08-25")
  })
})
