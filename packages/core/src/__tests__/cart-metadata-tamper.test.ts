import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { createRequest, createResponse, createStoreService, findRoute } from "./helpers/render-wire"
import { fakeAgentSessions } from "./helpers/agent-session-store"
import { computeSessionFingerprint } from "../lib/session-ownership"
import { resolveAcpStatus, resolveUcpStatus } from "../lib/status-maps"
import { createUcpVersionRegistry } from "../lib/ucp-version-registry"
import type { UcpResolution } from "../lib/ucp-version-resolver"

const completeRun = vi.hoisted(() => vi.fn(async () => {
  throw new Error("stop after settlement handoff")
}))

vi.mock("../workflows/complete-checkout-session", () => ({
  default: () => ({ run: completeRun }),
}))

const paymentFlows = vi.hoisted(() => ({
  createSessions: vi.fn(async () => ({})),
  deleteSessions: vi.fn(async () => ({})),
}))

vi.mock("@medusajs/medusa/core-flows", () => ({
  refreshPaymentCollectionForCartWorkflow: () => ({ run: async () => ({}) }),
  createPaymentSessionsWorkflow: () => ({ run: paymentFlows.createSessions }),
  deletePaymentSessionsWorkflow: () => ({ run: paymentFlows.deleteSessions }),
}))

vi.mock("@medusajs/framework/workflows-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@medusajs/framework/workflows-sdk")>()),
  createStep: (_name: string, invoke: unknown) => invoke,
}))

import { POST as ucpComplete } from "../api/ucp/checkout-sessions/[id]/complete/route"
import { POST as acpComplete } from "../api/acp/checkout_sessions/[id]/complete/route"
import { setupPaymentStep } from "../workflows/steps/setup-payment"
import { validateCheckoutPrerequisitesStep } from "../workflows/steps/validate-checkout-prerequisites"

const HANDLER_ID = "xyz.fd.prism_payment"
const QUOTED_AMOUNT = "1500000"
const QUOTED_TOTAL = 15
const MERCHANT = "0xmerchant"
const ATTACKER = "0xattacker"

function prismQuote(amount: string, payTo: string, total = QUOTED_TOTAL) {
  const accepts = [{ network: "eip155:84532", asset: "0xasset", amount, payTo }]
  return {
    preparedAmount: String(total),
    preparedCurrency: "usd",
    acp: { id: HANDLER_ID, config: { x402Version: 2, accepts } },
    ucp: { [HANDLER_ID]: [{ id: HANDLER_ID, config: { x402Version: 2, accepts } }] },
  }
}

const realQuote = prismQuote(QUOTED_AMOUNT, MERCHANT)
const forgedQuote = prismQuote("1", ATTACKER, 0.01)

function credential(value: string, to: string) {
  const payload = {
    accepted: { network: "eip155:84532", asset: "0xAsset", amount: value, payTo: to },
    payload: {
      signature: "0xsig",
      authorization: { from: "0x2222222222222222222222222222222222222222", to, value, validAfter: "0", validBefore: "9999999999", nonce: "0x0101010101010101010101010101010101010101010101010101010101010101" },
    },
  }
  return Buffer.from(JSON.stringify({ x402Version: 2, paymentPayload: payload })).toString("base64")
}

type Stored = { quote?: unknown; metadata?: Record<string, unknown> }

function completeRequest({ quote, metadata = {} }: Stored, authorization: string) {
  const { service } = createStoreService({ version: "2026-04-08" })
  ;(service as any).getPaymentProviderId = () => "pp_prism_prism"
  const sessions = fakeAgentSessions([{ cart_id: "cart_1", handler_data: quote ? { [HANDLER_ID]: quote } : {} }])
  const query = { graph: vi.fn(async () => ({ data: [{ id: "cart_1", items: [], metadata }] })) }
  completeRun.mockClear()
  const req = {
    ...createRequest({ agenticCommerce: service, query, agenticCommerceSession: sessions }, { id: "cart_1" }),
    body: { payment: { instruments: [{ id: "i1", handler_id: HANDLER_ID, type: "x402", credential: { type: "x402", authorization } }] } },
    validatedBody: {
      payment_data: { handler_id: HANDLER_ID, instrument: { credential: { authorization } } },
    },
  }
  return { req: req as any, res: createResponse() as any }
}

const completions = [
  ["UCP", ucpComplete],
  ["ACP", acpComplete],
] as const

describe.each(completions)("%s completion trusts only the quote the server stored", (_protocol, complete) => {
  beforeEach(() => { completeRun.mockClear() })

  it("rejects a quote the buyer wrote into cart metadata when the server stored none", async () => {
    const { req, res } = completeRequest({ metadata: { prism_checkout_data: forgedQuote } }, credential("1", ATTACKER))

    await complete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("rejects a credential signed to a buyer-written quote that differs from the stored quote", async () => {
    const { req, res } = completeRequest(
      { quote: realQuote, metadata: { prism_checkout_data: forgedQuote } },
      credential("1", ATTACKER),
    )

    await complete(req, res)

    expect(completeRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(422)
  })

  it("settles a credential signed to the stored quote even when the buyer wiped cart metadata", async () => {
    const { req, res } = completeRequest({ quote: realQuote, metadata: {} }, credential(QUOTED_AMOUNT, MERCHANT))

    await complete(req, res)

    expect(completeRun).toHaveBeenCalledTimes(1)
  })
})

describe.each(completions)("%s completion that settles", (_protocol, complete) => {
  it("answers with the completed session built from the stored quote", async () => {
    const { req, res } = completeRequest({ quote: realQuote }, credential(QUOTED_AMOUNT, MERCHANT))
    const cartModule = { updateCarts: vi.fn(async () => ({})) }
    const scope = req.scope
    req.scope = { resolve: (name: string) => (name === "cart" ? cartModule : scope.resolve(name)) }
    completeRun.mockResolvedValueOnce({ result: { order_id: "order_1" } } as never)

    await complete(req, res)

    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.body)).toContain("order_1")
    expect(cartModule.updateCarts).toHaveBeenCalledTimes(1)
  })
})

describe("payment session data handed to the provider", () => {
  async function runSetup(cartMetadata: Record<string, unknown>, sessions = fakeAgentSessions([{ cart_id: "cart_1", handler_data: { [HANDLER_ID]: realQuote } }])) {
    const cart = {
      id: "cart_1",
      total: QUOTED_TOTAL,
      currency_code: "usd",
      metadata: cartMetadata,
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    }
    const services: Record<string, unknown> = { query: { graph: vi.fn(async () => ({ data: [cart] })) }, agenticCommerceSession: sessions }
    paymentFlows.createSessions.mockClear()
    return (setupPaymentStep as unknown as (input: unknown, ctx: unknown) => Promise<unknown>)(
      {
        cart_id: "cart_1",
        payment_provider_id: "pp_prism_prism",
        ucp_version: "2026-04-08",
        payment_data: { eip3009_authorization: credential(QUOTED_AMOUNT, MERCHANT), x402_version: 2 },
      },
      { container: { resolve: (name: string) => services[name] } },
    )
  }

  function createdSessionData() {
    const call = paymentFlows.createSessions.mock.calls[0] as unknown as [{ input: { data: Record<string, unknown> } }]
    return call[0].input.data
  }

  it("carries the stored quote and ignores a quote the buyer wrote into cart metadata", async () => {
    await runSetup({ prism_checkout_data: forgedQuote })

    expect(createdSessionData().prism_checkout_data).toEqual(realQuote)
  })

  it("refuses to pay a cart whose only quote was written by the buyer", async () => {
    await expect(runSetup({ prism_checkout_data: forgedQuote }, fakeAgentSessions([{ cart_id: "cart_1" }]))).rejects.toThrow(/missing_payment_quote/)
    expect(paymentFlows.createSessions).not.toHaveBeenCalled()
  })
})

describe("payment under the cart lock", () => {
  async function runSetupWith(sessions: ReturnType<typeof fakeAgentSessions>) {
    const cart = {
      id: "cart_1",
      total: QUOTED_TOTAL,
      currency_code: "usd",
      payment_collection: { id: "paycol_1", amount: QUOTED_TOTAL, payment_sessions: [] },
    }
    const services: Record<string, unknown> = { query: { graph: vi.fn(async () => ({ data: [cart] })) }, agenticCommerceSession: sessions }
    paymentFlows.createSessions.mockClear()
    return (setupPaymentStep as unknown as (input: unknown, ctx: unknown) => Promise<unknown>)(
      { cart_id: "cart_1", payment_provider_id: "pp_prism_prism", ucp_version: "2026-04-08", payment_data: { eip3009_authorization: credential(QUOTED_AMOUNT, MERCHANT), x402_version: 2 } },
      { container: { resolve: (name: string) => services[name] } },
    )
  }

  it("refuses to pay a session that was canceled after the prerequisites were checked", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", canceled_at: "2026-10-09T00:00:00.000Z", handler_data: { [HANDLER_ID]: realQuote } }])
    await expect(runSetupWith(sessions)).rejects.toThrow(/canceled/)
    expect(paymentFlows.createSessions).not.toHaveBeenCalled()
  })

  it("refuses to pay a cart that has no session", async () => {
    await expect(runSetupWith(fakeAgentSessions([]))).rejects.toThrow(/not found/)
    expect(paymentFlows.createSessions).not.toHaveBeenCalled()
  })
})

describe("checkout formatting", () => {
  it("fails loudly for a cart that was not loaded with its agent session", () => {
    const { service } = createStoreService({ version: "2026-04-08" })
    expect(() => service.formatUcpCheckoutSession({ id: "cart_1", metadata: {} }, "https://store.test/ucp/checkout-sessions")).toThrow(/agent session/)
    expect(() => service.formatAcpCheckoutSession({ id: "cart_1", metadata: {} }, "https://store.test/acp/checkout_sessions")).toThrow(/agent session/)
  })
})

describe("session ownership", () => {
  const agentA = { authorization: "Bearer key-a" }
  const agentB = { authorization: "Bearer key-b" }
  const fingerprintOf = (headers: Record<string, string>) => computeSessionFingerprint({ headers })

  async function ownerCheck(headers: Record<string, string>, row: { session_fingerprint: string } | null, metadata: Record<string, unknown>) {
    const route = findRoute("/acp/checkout_sessions/:id")
    const sessions = fakeAgentSessions(row ? [{ cart_id: "cart_1", ...row }] : [])
    const query = { graph: vi.fn(async () => ({ data: [{ id: "cart_1", metadata }] })) }
    const req = { ...createRequest({ query, agenticCommerceSession: sessions }, { id: "cart_1" }), headers, path: "/acp/checkout_sessions/cart_1" }
    const res = createResponse()
    let passed = false
    await route.middlewares[0](req, res, () => { passed = true })
    return { passed, res }
  }

  it("lets the agent that opened the session through", async () => {
    const { passed } = await ownerCheck(agentA, { session_fingerprint: fingerprintOf(agentA) }, {})
    expect(passed).toBe(true)
  })

  it("rejects another agent that rewrote the fingerprint in cart metadata to its own", async () => {
    const { passed, res } = await ownerCheck(agentB, { session_fingerprint: fingerprintOf(agentA) }, { session_fingerprint: fingerprintOf(agentB) })
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it("rejects another agent when the fingerprint was deleted from cart metadata", async () => {
    const { passed, res } = await ownerCheck(agentB, { session_fingerprint: fingerprintOf(agentA) }, {})
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it("rejects a cart that no agent opened a session for", async () => {
    const { passed, res } = await ownerCheck(agentB, null, { session_fingerprint: fingerprintOf(agentB) })
    expect(passed).toBe(false)
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it("rejects the request when the session store cannot be read", async () => {
    const route = findRoute("/acp/checkout_sessions/:id")
    const broken = { find: async () => { throw new Error("db down") } }
    const req = { ...createRequest({ query: { graph: async () => ({ data: [{ id: "cart_1", metadata: {} }] }) }, agenticCommerceSession: broken }, { id: "cart_1" }), headers: agentA, path: "/acp/checkout_sessions/cart_1" }
    const res = createResponse()
    let passed = false
    await route.middlewares[0](req, res, () => { passed = true })
    expect(passed).toBe(false)
  })
})

describe("UCP version pin", () => {
  const registry = createUcpVersionRegistry({ ucp_version: "2026-04-08" })
  const resolution = (version: string): UcpResolution => ({ version, wire: registry.wire(version), outcome: "unreachable", host: "agent.example" })

  it("keeps the pinned version when the buyer erased the pin from cart metadata", async () => {
    const route = findRoute("/ucp/checkout-sessions/:id")
    const pin = route.middlewares.find((m) => m.name === "enforceSessionVersionPin")!
    const { service } = createStoreService({ version: "2026-04-08" })
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", ucp_version: "2026-08-25" }])
    const services = {
      agenticCommerce: service,
      logger: { warn: () => undefined },
      query: { graph: async () => ({ data: [{ id: "cart_1", metadata: {} }] }) },
      agenticCommerceSession: sessions,
    }
    const req: any = { params: { id: "cart_1" }, ucp: resolution("2026-04-08"), scope: { resolve: (n: string) => (services as any)[n] } }
    await pin(req, createResponse(), () => undefined)
    expect(req.ucp.version).toBe("2026-08-25")
  })
})

describe("cancelled checkout session", () => {
  const cancelledRow = { cart_id: "cart_1", canceled_at: "2026-10-09T00:00:00.000Z" }

  it("stays cancelled in the UCP and ACP status when the buyer removed the cancel flag from cart metadata", () => {
    const cart = { id: "cart_1", metadata: {}, agent_session: cancelledRow }
    expect(resolveUcpStatus(cart)).toBe("canceled")
    expect(resolveAcpStatus(cart)).toBe("canceled")
  })

  it("is refused at completion when the buyer removed the cancel flag from cart metadata", async () => {
    const services: Record<string, unknown> = {
      query: { graph: async () => ({ data: [{ id: "cart_1", metadata: {}, items: [{ id: "i" }], email: "a@b.c", shipping_address: { id: "a" } }] }) },
      agenticCommerceSession: fakeAgentSessions([cancelledRow]),
    }
    await expect(
      (validateCheckoutPrerequisitesStep as unknown as (input: unknown, ctx: unknown) => Promise<unknown>)(
        { cart_id: "cart_1" },
        { container: { resolve: (name: string) => services[name] } },
      ),
    ).rejects.toThrow(/cancel/i)
  })

  it("is refused at completion when the cart has no session row", async () => {
    const services: Record<string, unknown> = {
      query: { graph: async () => ({ data: [{ id: "cart_1", metadata: {}, items: [{ id: "i" }], email: "a@b.c", shipping_address: { id: "a" } }] }) },
      agenticCommerceSession: fakeAgentSessions([]),
    }
    await expect(
      (validateCheckoutPrerequisitesStep as unknown as (input: unknown, ctx: unknown) => Promise<unknown>)(
        { cart_id: "cart_1" },
        { container: { resolve: (name: string) => services[name] } },
      ),
    ).rejects.toThrow()
  })
})

describe("reserved session keys", () => {
  const SRC = join(__dirname, "..")
  const READS_RESERVED_KEY =
    /metadata\??\.(session_fingerprint|checkout_session_canceled|ucp_version|prism_checkout_data)\b|metadata\??\.\[PRISM_CHECKOUT_DATA_KEY\]|metadata\??\.\[["'](session_fingerprint|checkout_session_canceled)["']\]/

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === "__tests__" || name === "__fixtures__" ? [] : sources(path)
      return /\.tsx?$/.test(name) ? [path] : []
    })
  }

  it("is never read back from cart metadata", () => {
    const offenders = sources(SRC)
      .filter((file) => READS_RESERVED_KEY.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file).split(sep).join("/"))
    expect(offenders).toEqual([])
  })
})
