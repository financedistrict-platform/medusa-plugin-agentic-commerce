import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

type Lane = "empty" | "prism"

const [origDir, inputsDir, outDir, laneArg, recordedPrism] = process.argv.slice(2)
if (!origDir || !inputsDir || !outDir || (laneArg !== "empty" && laneArg !== "prism")) {
  console.error("usage: capture-original.ts <orig-dir> <inputs-dir> <out-dir> <empty|prism> [recorded-prism-json]")
  process.exit(2)
}
const lane = laneArg as Lane
if (lane === "prism" && !recordedPrism) {
  console.error("lane prism needs a recorded Prism response")
  process.exit(2)
}

const requireFrom = createRequire(join(resolve(origDir), "package.json"))
const packageSource = (name: string) => join(dirname(requireFrom.resolve(`${name}/package.json`)), ".medusa", "server", "src")
const coreRoot = packageSource("@financedistrict/medusa-plugin-agentic-commerce")
const prismRoot = packageSource("@financedistrict/medusa-plugin-prism-payment")

const middlewares = requireFrom(`${coreRoot}/api/middlewares.js`).default
const AgenticCommerceService = requireFrom(`${coreRoot}/modules/agentic-commerce/service.js`).default
const ucpFormatter = requireFrom(`${coreRoot}/lib/formatters/ucp.js`)
const errorFormatters = requireFrom(`${coreRoot}/lib/error-formatters.js`)

const storeOptions = { store_name: "Demo Store", storefront_url: "https://store.test", payment_provider_id: "pp_prism_prism" }
const service = new AgenticCommerceService({}, lane === "prism"
  ? { ...storeOptions, payment_handler_adapters: ["prismPaymentHandler"] }
  : storeOptions)

let adapter: unknown
if (lane === "prism") {
  const PrismPaymentHandlerAdapter = requireFrom(`${prismRoot}/modules/prism-payment-handler/service.js`).default
  adapter = new PrismPaymentHandlerAdapter({}, { api_url: "https://gw.example", api_key: "test-key" })
  const recorded = readFileSync(resolve(recordedPrism!))
  globalThis.fetch = async () => new Response(recorded, { status: 200, headers: { "content-type": "application/json" } })
}

const services: Record<string, unknown> = { agenticCommerce: service, prismPaymentHandler: adapter }
const req = {
  protocol: "https",
  get: (h: string) => (h.toLowerCase() === "host" ? "store.test" : undefined),
  headers: { host: "store.test" },
  scope: { resolve: (n: string) => services[n] },
}

const readInput = (name: string) => JSON.parse(readFileSync(join(inputsDir, name), "utf8"))
const write = (name: string, value: unknown) => writeFileSync(join(outDir, name), JSON.stringify(value, null, 2))

async function captureProfile(): Promise<unknown> {
  const route = middlewares.routes.find((r: { matcher: string }) => r.matcher === "/.well-known/ucp")
  let captured: unknown
  const res = { json: (b: unknown) => { captured = b } }
  await route.middlewares[0](req, res, () => undefined)
  await route.middlewares[1](req, res)
  return captured
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  write("profile.json", await captureProfile())

  service.resolveAdapters(req.scope)
  const checkoutBase = "https://store.test/ucp/checkout-sessions"
  const session = readInput("checkout-session.json")
  write("checkout__create.json", service.formatUcpCheckoutSession(session.cart, checkoutBase, session.shipping_options))
  write("checkout__complete.json", service.formatUcpCheckoutSession(readInput("checkout-session-completed.json").cart, checkoutBase))
  write("cart__create.json", service.formatUcpCart(readInput("cart.json").cart, "https://store.test/ucp/carts"))
  write("order__get.json", ucpFormatter.formatUcpOrder(
    { storeName: "Demo Store", storefrontUrl: "https://store.test", ucpVersion: service.getUcpVersion(), acpVersion: service.getAcpVersion(), paymentHandlers: service.getPaymentHandlerService() },
    readInput("order.json").order,
    "https://store.test/ucp/orders",
  ))

  const errors = readInput("errors.json")
  for (const [name, params] of Object.entries(errors as Record<string, Record<string, string>>)) {
    write(`error__${name}.json`, errorFormatters.formatUcpError({ ucpVersion: service.getUcpVersion(), ...params }))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
