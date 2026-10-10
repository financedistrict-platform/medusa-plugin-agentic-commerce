import { describe, it, expect, vi } from "vitest"
import { readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import middlewares from "../api/middlewares"
import { createRequest, createResponse, createStoreService, findRoute } from "./helpers/render-wire"
import { fakeAgentSessions } from "./helpers/agent-session-store"
import { computeSessionFingerprint } from "../lib/session-ownership"

const createRun = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ result: { id: "cart_1" } })))

vi.mock("../workflows/create-checkout-session", () => ({
  default: () => ({ run: createRun }),
}))

import { POST as ucpCartCreate } from "../api/ucp/carts/route"
import { POST as ucpCheckoutCreate } from "../api/ucp/checkout-sessions/route"
import { POST as acpCheckoutCreate } from "../api/acp/checkout_sessions/route"

const SECRET_HEADER = "ucp-session-secret"
const PLATFORM_AGENT = 'shopping-agent/1.0; profile="https://agent.example/profile.json"'
const buyerA = { "ucp-agent": PLATFORM_AGENT }

type Headers = Record<string, string>

function createUcp(headers: Headers = buyerA) {
  const { service } = createStoreService({ version: "2026-04-08" })
  ;(service as any).getPaymentHandlerService = () => ({ prepareCheckoutPayment: vi.fn().mockResolvedValue({}) })
  const query = { graph: vi.fn(async () => ({ data: [{ id: "cart_1", items: [], metadata: {} }] })) }
  const sessions = fakeAgentSessions([{ cart_id: "cart_1" }])
  createRun.mockClear()
  const req = {
    ...createRequest({ agenticCommerce: service, query, agenticCommerceSession: sessions }),
    headers: { host: "store.test", ...headers },
    validatedBody: { line_items: [] },
  }
  return { req: req as any, res: createResponse() as any }
}

function storedFingerprint(): string {
  const calls = createRun.mock.calls as unknown as [{ input: { session_fingerprint: string } }][]
  return calls[0][0].input.session_fingerprint
}

async function issue() {
  const { req, res } = createUcp()
  await ucpCartCreate(req, res)
  return { fingerprint: storedFingerprint(), secret: res.headers[SECRET_HEADER] as string }
}

function ownerRun(matcher: string, headers: Headers, stored: string | null, path: string) {
  const route = findRoute(matcher)
  const sessions = fakeAgentSessions(stored === null ? [] : [{ cart_id: "cart_1", session_fingerprint: stored }])
  const { service } = createStoreService({ version: "2026-04-08" })
  const req = {
    ...createRequest({ agenticCommerce: service, agenticCommerceSession: sessions }, { id: "cart_1" }),
    headers: { host: "store.test", ...headers },
    path,
  }
  const res = createResponse()
  let passed = false
  return route.middlewares[0](req, res, () => { passed = true }).then(() => ({ passed, res }))
}

const ucpSessionRoutes = [
  ["/ucp/checkout-sessions/:id", "/ucp/checkout-sessions/cart_1"],
  ["/ucp/checkout-sessions/:id/complete", "/ucp/checkout-sessions/cart_1/complete"],
  ["/ucp/checkout-sessions/:id/cancel", "/ucp/checkout-sessions/cart_1/cancel"],
  ["/ucp/carts/:id", "/ucp/carts/cart_1"],
  ["/ucp/carts/:id/cancel", "/ucp/carts/cart_1/cancel"],
] as const

describe.each([
  ["cart", ucpCartCreate],
  ["checkout session", ucpCheckoutCreate],
] as const)("a UCP %s is owned by a secret issued at creation", (_name, create) => {
  it("returns a fresh random secret in a response header on every creation", async () => {
    const first = createUcp()
    await create(first.req, first.res)
    const second = createUcp()
    await create(second.req, second.res)

    const secretA = first.res.headers[SECRET_HEADER]
    const secretB = second.res.headers[SECRET_HEADER]
    expect(secretA).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(secretB).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(secretA).not.toBe(secretB)
  })

  it("stores a fingerprint that is neither the secret nor derived from the agent header", async () => {
    const first = createUcp()
    await create(first.req, first.res)
    const fingerprintA = storedFingerprint()
    const second = createUcp()
    await create(second.req, second.res)
    const fingerprintB = storedFingerprint()

    expect(fingerprintA).not.toContain(first.res.headers[SECRET_HEADER])
    expect(fingerprintA).not.toBe(fingerprintB)
  })

  it("does not send a secret when the session could not be created", async () => {
    const failing = createUcp()
    createRun.mockRejectedValueOnce(new Error("boom"))

    await create(failing.req, failing.res)

    expect(failing.res.statusCode).toBe(500)
    expect(failing.res.headers[SECRET_HEADER]).toBeUndefined()
  })
})

describe.each(ucpSessionRoutes)("UCP session ownership on %s", (matcher, path) => {
  it("lets the buyer holding the issued secret through", async () => {
    const { fingerprint, secret } = await issue()
    const { passed } = await ownerRun(matcher, { ...buyerA, [SECRET_HEADER]: secret }, fingerprint, path)
    expect(passed).toBe(true)
  })

  it("rejects another buyer of the same agent platform that sends the same UCP-Agent header", async () => {
    const { fingerprint } = await issue()
    const { passed, res } = await ownerRun(matcher, buyerA, fingerprint, path)
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it("rejects a wrong secret", async () => {
    const { fingerprint } = await issue()
    const { passed, res } = await ownerRun(matcher, { ...buyerA, [SECRET_HEADER]: "not-the-secret" }, fingerprint, path)
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it("rejects a valid store API key presented without the secret", async () => {
    const { fingerprint } = await issue()
    const { passed, res } = await ownerRun(matcher, { ...buyerA, authorization: "Bearer any-key" }, fingerprint, path)
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it("rejects a request without credentials even when the stored fingerprint is the anonymous marker", async () => {
    const { passed, res } = await ownerRun(matcher, {}, "anonymous", path)
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it("rejects a session whose stored fingerprint is empty", async () => {
    const { passed, res } = await ownerRun(matcher, buyerA, "", path)
    expect(passed).toBe(false)
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})

describe("ACP session creation", () => {
  it("refuses to open a session for a request that carries no API key", async () => {
    const { service } = createStoreService({ version: "2026-04-08" })
    const req: any = {
      ...createRequest({ agenticCommerce: service, agenticCommerceSession: fakeAgentSessions([]) }),
      validatedBody: { line_items: [] },
    }
    const res = createResponse()
    createRun.mockClear()

    await acpCheckoutCreate(req, res as any)

    expect(createRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })
})

describe("session fingerprints", () => {
  it("never derives a UCP fingerprint from the agent header or a bearer token", () => {
    expect(computeSessionFingerprint("ucp", buyerA)).toBeNull()
    expect(computeSessionFingerprint("ucp", { ...buyerA, authorization: "Bearer key" })).toBeNull()
  })

  it("returns no fingerprint when nothing identifies the caller", () => {
    expect(computeSessionFingerprint("acp", {})).toBeNull()
  })
})

const orderCartLinks = [
  { order_id: "order_1", cart_id: "cart_1" },
  { order_id: "order_orphan", cart_id: "cart_none" },
]

function orderRun(matcher: string, headers: Headers, sessionFingerprint: string, id = "order_1", store?: unknown, path = matcher.replace(":id", id)) {
  const route = findRoute(matcher)
  const sessions = store ?? fakeAgentSessions([{ cart_id: "cart_1", session_fingerprint: sessionFingerprint }])
  const query = {
    graph: vi.fn(async ({ entity, filters }: { entity: string; filters: { order_id: string } }) => {
      if (entity !== "order_cart") return { data: [{ id: filters.order_id }] }
      return { data: orderCartLinks.filter((link) => link.order_id === filters.order_id) }
    }),
  }
  const { service } = createStoreService({ version: "2026-04-08" })
  const req = {
    ...createRequest({ agenticCommerce: service, query, agenticCommerceSession: sessions }, { id }),
    headers: { host: "store.test", ...headers },
    path,
  }
  const res = createResponse()
  let passed = false
  return route.middlewares[0](req, res, () => { passed = true }).then(() => ({ passed, res }))
}

describe("UCP order reads", () => {
  const matcher = "/ucp/orders/:id"
  const ownerFingerprint = (secret: string) => computeSessionFingerprint("ucp", { [SECRET_HEADER]: secret })!
  const withSecret = (secret: string) => ({ ...buyerA, [SECRET_HEADER]: secret })

  it("serves the buyer who holds the secret of the session that placed the order", async () => {
    const { passed } = await orderRun(matcher, withSecret("secret-a"), ownerFingerprint("secret-a"))
    expect(passed).toBe(true)
  })

  it("answers 404 to another buyer of the same agent platform", async () => {
    const { passed, res } = await orderRun(matcher, buyerA, ownerFingerprint("secret-a"))
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(404)
  })

  it("answers 404 to a wrong secret", async () => {
    const { passed, res } = await orderRun(matcher, withSecret("secret-b"), ownerFingerprint("secret-a"))
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(404)
  })

  it("answers the same 404 for an order id that does not exist", async () => {
    const { passed, res } = await orderRun(matcher, withSecret("secret-a"), ownerFingerprint("secret-a"), "order_missing")
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(404)
  })

  it.each(["order_unlinked", "order_orphan"])("answers 404 for %s, which no agent session placed", async (id) => {
    const { passed, res } = await orderRun(matcher, withSecret("secret-a"), ownerFingerprint("secret-a"), id)
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(404)
  })

  it("keeps the UCP error envelope and the secret check when the path is written in another letter case", async () => {
    const wrongKey = await orderRun(matcher, { ...buyerA, authorization: "Bearer key-a" }, ownerFingerprint("secret-a"), "order_1", undefined, "/UCP/orders/order_1")
    const right = await orderRun(matcher, withSecret("secret-a"), ownerFingerprint("secret-a"), "order_1", undefined, "/UCP/orders/order_1")
    expect(wrongKey.passed).toBe(false)
    expect(wrongKey.res.statusCode).toBe(404)
    expect((wrongKey.res.body as any).messages?.[0]?.code ?? (wrongKey.res.body as any).code).toBe("not_found")
    expect(right.passed).toBe(true)
  })

  it("does not serve the order when the session store cannot be read", async () => {
    const broken = { find: async () => { throw new Error("db down") } }
    const { passed, res } = await orderRun(matcher, withSecret("secret-a"), "", "order_1", broken)
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(500)
  })
})

describe("ACP order reads", () => {
  const matcher = "/acp/orders/:id"
  const keyA = { authorization: "Bearer key-a" }
  const keyB = { authorization: "Bearer key-b" }
  const fingerprintOf = (headers: Headers) => computeSessionFingerprint("acp", headers)!

  it("serves the API key that opened the session which placed the order", async () => {
    const { passed } = await orderRun(matcher, keyA, fingerprintOf(keyA))
    expect(passed).toBe(true)
  })

  it("answers 404 to another valid API key", async () => {
    const { passed, res } = await orderRun(matcher, keyB, fingerprintOf(keyA))
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(404)
  })

  it("answers 404 for an order that no agent session placed", async () => {
    const { passed, res } = await orderRun(matcher, keyA, fingerprintOf(keyA), "order_unlinked")
    expect(passed).toBe(false)
    expect(res.statusCode).toBe(404)
  })
})

describe("every UCP and ACP route that touches a session or an order is behind an ownership guard", () => {
  const API = join(__dirname, "..", "api")
  const OPEN = new Set([
    "/ucp/carts",
    "/ucp/checkout-sessions",
    "/acp/checkout_sessions",
    "/ucp/catalog/search",
    "/ucp/catalog/lookup",
    "/acp/product-feed",
  ])

  function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return routeFiles(path)
      return name === "route.ts" ? [path] : []
    })
  }

  const urls = ["ucp", "acp"].flatMap((protocol) =>
    routeFiles(join(API, protocol)).map((file) =>
      "/" + [protocol, ...relative(join(API, protocol), file).split(sep).slice(0, -1)].join("/").replace(/\[(\w+)\]/g, ":$1"),
    ),
  )

  it("finds the route files it is meant to guard", () => {
    expect(urls).toContain("/ucp/orders/:id")
    expect(urls).toContain("/acp/checkout_sessions/:id/complete")
  })

  it.each(urls.filter((url) => !OPEN.has(url)))("%s", (url) => {
    const routes = (middlewares as unknown as { routes: { matcher: string; middlewares: { name: string }[] }[] }).routes
    const guards = routes
      .filter((route) => route.matcher === url)
      .flatMap((route) => route.middlewares.map((middleware) => middleware.name))
    expect(guards.some((name) => name === "sessionOwnerGuard" || name === "orderOwnerGuard")).toBe(true)
  })
})
