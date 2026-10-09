import { readFileSync } from "node:fs"
import { join } from "node:path"
import { vi } from "vitest"
import middlewares from "../../api/middlewares"
import AgenticCommerceService from "../../modules/agentic-commerce/service"
import PrismPaymentHandlerAdapter from "../../../../prism-payment/src/modules/prism-payment-handler/service"

export const FIXTURES = join(__dirname, "..", "..", "__fixtures__")
export const UCP_FIXTURES = join(FIXTURES, "ucp")
export const PRISM_FIXTURES = join(FIXTURES, "prism")
export const PRISM_HANDLER_ID = "xyz.fd.prism_payment"
export const PRISM_OWNED_KEYS = ["id", "version", "spec", "schema", "config_schema", "instrument_schemas", "available_instruments"]

export type RenderOptions = {
  version: string
  supported?: string[]
  recordedPrism?: string
}

export type RenderedFixtures = Record<string, unknown>

type Route = { matcher: string; method?: string; middlewares: ((...args: any[]) => unknown)[] }

const input = (name: string) => JSON.parse(readFileSync(join(UCP_FIXTURES, "inputs", name), "utf8"))

export function readFixture(folder: string, name: string): string {
  return readFileSync(join(UCP_FIXTURES, folder, name), "utf8")
}

export function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function createStoreService(options: RenderOptions) {
  const service = new AgenticCommerceService({}, {
    store_name: "Demo Store",
    payment_provider_id: "pp_prism_prism",
    storefront_url: "https://store.test",
    ucp_version: options.version,
    ucp_supported_versions: options.supported ?? [],
    ...(options.recordedPrism ? { payment_handler_adapters: ["prismPaymentHandler"] } : {}),
  })
  const adapter = options.recordedPrism
    ? new PrismPaymentHandlerAdapter({}, { api_url: "https://gw.example", api_key: "test-key" })
    : undefined
  return { service, adapter }
}

export function createRequest(services: Record<string, unknown>, params: Record<string, string> = {}) {
  return {
    protocol: "https",
    get: (h: string) => (h.toLowerCase() === "host" ? "store.test" : undefined),
    headers: { host: "store.test" },
    params,
    scope: { resolve: (n: string) => services[n] },
  }
}

export function createResponse() {
  const res: { statusCode: number; body: unknown; status(code: number): typeof res; json(body: unknown): typeof res } = {
    statusCode: 200,
    body: undefined,
    status(code: number) { res.statusCode = code; return res },
    json(body: unknown) { res.body = body; return res },
  }
  return res
}

export function findRoute(matcher: string): Route {
  const route = (middlewares as unknown as { routes: Route[] }).routes.find((r) => r.matcher === matcher)
  if (!route) throw new Error(`route ${matcher} not registered`)
  return route
}

export async function runRoute(matcher: string, req: ReturnType<typeof createRequest>) {
  const route = findRoute(matcher)
  const res = createResponse()
  await route.middlewares[0](req, res, () => undefined)
  await route.middlewares[1](req, res)
  return res
}

export function stubPrism(recordedPrism: string) {
  const bytes = readFileSync(join(PRISM_FIXTURES, recordedPrism))
  vi.stubGlobal("fetch", async () => new Response(bytes, { status: 200, headers: { "content-type": "application/json" } }))
}

export async function renderFixtures(options: RenderOptions): Promise<RenderedFixtures> {
  if (options.recordedPrism) stubPrism(options.recordedPrism)
  const { service, adapter } = createStoreService(options)
  const req = createRequest({ agenticCommerce: service, prismPaymentHandler: adapter })
  const wire = service.getUcpRegistry().wire(options.version)

  const out: RenderedFixtures = {}
  out["profile.json"] = (await runRoute("/.well-known/ucp", req)).body

  service.resolveAdapters(req.scope)
  const checkoutBase = "https://store.test/ucp/checkout-sessions"
  const session = input("checkout-session.json")
  out["checkout__create.json"] = service.formatUcpCheckoutSession(session.cart, checkoutBase, session.shipping_options, options.version)
  out["checkout__complete.json"] = service.formatUcpCheckoutSession(input("checkout-session-completed.json").cart, checkoutBase, undefined, options.version)
  if (wire.supports("cart")) {
    out["cart__create.json"] = service.formatUcpCart(input("cart.json").cart, "https://store.test/ucp/carts", options.version)
  }
  out["order__get.json"] = service.formatUcpOrder(input("order.json").order, "https://store.test/ucp/orders", options.version)
  for (const [name, params] of Object.entries(input("errors.json") as Record<string, { code: string; content: string; severity?: any }>)) {
    out[`error__${name}.json`] = wire.error(params)
  }
  vi.unstubAllGlobals()
  return out
}

export function withoutPrismOwnedKeys(document: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(document))
  const handlers = copy?.ucp?.payment_handlers?.[PRISM_HANDLER_ID]
  if (Array.isArray(handlers)) {
    copy.ucp.payment_handlers[PRISM_HANDLER_ID] = handlers.map((entry: Record<string, unknown>) => {
      const rest = { ...entry }
      for (const key of PRISM_OWNED_KEYS) delete rest[key]
      return rest
    })
  }
  return copy
}
