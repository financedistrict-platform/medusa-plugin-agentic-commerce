import { beforeEach, describe, expect, it, vi } from "vitest"
import { ContainerRegistrationKeys, Modules, createMedusaContainer } from "@medusajs/framework/utils"
import { asValue } from "@medusajs/framework/awilix"
import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import PaymentModuleService from "@medusajs/payment/dist/services/payment-module"
import PaymentProviderService from "@medusajs/payment/dist/services/payment-provider"
import PrismPaymentProviderService from "../../../prism-payment/src/modules/prism-payment/service"
import { checkoutData, credential, encode, CART_TOTAL, NETWORK, QUOTE_SIGNING_KEY } from "../../../prism-payment/src/__tests__/helpers/quoted-payment"
import "../workflows/hooks/complete-cart-agent-guard"
import "../workflows/hooks/complete-cart-provider-called"
import { Redacted, withCredentialHandoff } from "../lib/credential-handoff"
import { credentialSha256 } from "../lib/credential-digest"
import { fakeAgentSessions } from "./helpers/agent-session-store"
import { AGENT_CHECKOUT_REQUIRED } from "../lib/agent-completion-guard"

const PROVIDER_ID = "pp_prism_prism"
const SESSION_ID = "payses_1"

type StoredSession = { id: string; provider_id: string; status: string; amount: number; currency_code: string; data: Record<string, unknown> }

function prismProvider() {
  const provider = new PrismPaymentProviderService({}, { api_url: "https://gw.test", api_key: QUOTE_SIGNING_KEY } as never)
  const client = {
    verifyPayment: vi.fn().mockResolvedValue({ isValid: true }),
    settlePayment: vi.fn().mockResolvedValue({ success: true, transaction: "0xtx", network: NETWORK }),
    getApiKey: () => QUOTE_SIGNING_KEY,
  }
  ;(provider as unknown as { client: typeof client }).client = client
  return { provider, client }
}

function paymentModuleOver(providers: PaymentProviderService, sessions: Map<string, StoredSession>) {
  const serialize = async <T>(value: T) => value
  const engine = {
    baseRepository_: { getFreshManager: () => ({}), serialize },
    paymentSessionService_: {
      retrieve: async (id: string) => ({ ...sessions.get(id)!, payment: null, authorized_at: null, payment_collection_id: "paycol_1" }),
      update: async (update: { id: string; status?: string; data?: Record<string, unknown> }) => {
        const stored = sessions.get(update.id)!
        sessions.set(update.id, { ...stored, status: update.status ?? stored.status, data: update.data ?? stored.data })
        return sessions.get(update.id)
      },
    },
    paymentProviderService_: providers,
    authorizePaymentSession_: async (session: StoredSession, data: Record<string, unknown>, status: string) => {
      sessions.set(session.id, { ...sessions.get(session.id)!, status, data })
      return { id: "pay_1", currency_code: session.currency_code, captures: [], data }
    },
    maybeUpdatePaymentCollection_: async () => undefined,
  }
  return {
    async createPaymentSession(input: { provider_id: string; amount: number; currency_code: string; data: Record<string, unknown> }) {
      const initiated = await providers.createSession(input.provider_id, { data: { ...input.data, session_id: SESSION_ID }, amount: input.amount, currency_code: input.currency_code, context: { idempotency_key: SESSION_ID } } as never)
      sessions.set(SESSION_ID, { id: SESSION_ID, provider_id: input.provider_id, status: "pending", amount: input.amount, currency_code: input.currency_code, data: { ...input.data, ...(initiated.data as Record<string, unknown>) } })
      return sessions.get(SESSION_ID)
    },
    authorizePaymentSession: (id: string, context: Record<string, unknown>) =>
      (PaymentModuleService.prototype.authorizePaymentSession as (this: unknown, id: string, context: Record<string, unknown>) => Promise<unknown>).call(engine, id, context),
    retrievePaymentSession: async (id: string) => sessions.get(id),
    cancelPayment: async () => undefined,
    refundPayment: async () => undefined,
  }
}

function moduleStub<T extends Record<string, unknown>>(explicit: T): T {
  return new Proxy(explicit, {
    get: (target, key) => (typeof key === "string" && !(key in target) ? async () => [] : target[key as keyof T]),
  })
}

function cartWith(session: StoredSession) {
  return {
    id: "cart_1",
    currency_code: session.currency_code,
    total: CART_TOTAL,
    credit_line_total: 0,
    email: "buyer@shop.test",
    region: { id: "reg_1" },
    region_id: undefined,
    sales_channel_id: "sc_1",
    metadata: {},
    items: [{
      id: "item_1",
      title: "Mug",
      quantity: 1,
      unit_price: CART_TOTAL,
      variant_id: "variant_1",
      requires_shipping: false,
      is_tax_inclusive: false,
      variant: { id: "variant_1", manage_inventory: false, allow_backorder: false, inventory_items: [], product: { id: "prod_1", title: "Mug" } },
      tax_lines: [],
      adjustments: [],
    }],
    shipping_methods: [],
    credit_lines: [],
    promotions: [],
    payment_collection: { id: "paycol_1", amount: CART_TOTAL, payment_sessions: [session] },
  }
}

function containerFor(sessions: Map<string, StoredSession>, agentSessions: ReturnType<typeof fakeAgentSessions>, provider: PrismPaymentProviderService) {
  const container = createMedusaContainer()
  const providers = new PaymentProviderService({ [PROVIDER_ID]: provider } as never)
  const payment = paymentModuleOver(providers, sessions)
  const order = {
    createOrders: vi.fn(async (orders: Record<string, unknown>[]) => orders.map((input, index) => ({ id: `order_${index + 1}`, ...input, items: [{ id: "oitem_1", variant_id: "variant_1", quantity: 1 }] }))),
    deleteOrders: vi.fn(async () => undefined),
    addOrderTransactions: vi.fn(async () => []),
    listOrders: vi.fn(async () => []),
  }
  const query = {
    graph: vi.fn(async ({ entity }: { entity: string }) => {
      if (entity === "order_cart") return { data: [] }
      if (entity === "cart") return { data: [cartWith(sessions.get(SESSION_ID)!)] }
      return { data: [] }
    }),
  }
  container.register({
    [ContainerRegistrationKeys.QUERY]: asValue(query),
    [ContainerRegistrationKeys.LINK]: asValue({ create: vi.fn(async () => []), dismiss: vi.fn(async () => []) }),
    [ContainerRegistrationKeys.LOGGER]: asValue({ info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }),
    [Modules.LOCKING]: asValue(moduleStub({ acquire: vi.fn(async () => undefined), release: vi.fn(async () => true), execute: async (_keys: unknown, run: () => unknown) => run() })),
    [Modules.ORDER]: asValue(moduleStub(order)),
    [Modules.CART]: asValue(moduleStub({ updateCarts: vi.fn(async (carts: unknown) => carts), listCarts: vi.fn(async () => []) })),
    [Modules.INVENTORY]: asValue(moduleStub({ createReservationItems: vi.fn(async () => []), deleteReservationItems: vi.fn(async () => undefined), confirmInventory: vi.fn(async () => true) })),
    [Modules.PROMOTION]: asValue(moduleStub({ registerUsage: vi.fn(async () => undefined), revertUsage: vi.fn(async () => undefined) })),
    [Modules.EVENT_BUS]: asValue(moduleStub({ emit: vi.fn(async () => undefined), releaseGroupedEvents: vi.fn(async () => undefined), clearGroupedEvents: vi.fn(async () => undefined) })),
    [Modules.PAYMENT]: asValue(moduleStub(payment)),
    agenticCommerceSession: asValue(agentSessions),
  })
  return { container, payment, order }
}

const agentCheckout = createWorkflow("credential-handoff-propagation-probe", (input: { cart_id: string }) => {
  const completed = completeCartWorkflow.runAsStep({ input: { id: input.cart_id } })
  return new WorkflowResponse(completed)
})

describe("the credential handoff through Medusa's cart completion", () => {
  const handed = encode(credential())
  let provider: PrismPaymentProviderService
  let client: ReturnType<typeof prismProvider>["client"]
  let sessions: Map<string, StoredSession>

  beforeEach(() => {
    ;({ provider, client } = prismProvider())
    sessions = new Map()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  function agentSessionsSettling() {
    const at = new Date().toISOString()
    return fakeAgentSessions([{
      cart_id: "cart_1",
      pending_settlement: { state: "settling", credential_sha256: credentialSha256(handed), resumed: false, started_at: at, updated_at: at, provider_called_at: null },
    }])
  }

  async function createPrismSession(payment: ReturnType<typeof containerFor>["payment"], data: Record<string, unknown>) {
    await payment.createPaymentSession({ provider_id: PROVIDER_ID, amount: CART_TOTAL, currency_code: "usd", data })
  }

  it("lets the Prism provider read the handed credential inside completeCartWorkflow and settle it once", async () => {
    const agentSessions = agentSessionsSettling()
    const { container, payment, order } = containerFor(sessions, agentSessions, provider)
    await createPrismSession(payment, { prism_checkout_data: checkoutData, credential_sha256: credentialSha256(handed), x402_version: 2 })
    const authorize = vi.spyOn(provider, "authorizePayment")

    const { result } = await withCredentialHandoff(new Redacted(handed), () =>
      agentCheckout(container).run({ input: { cart_id: "cart_1" } }),
    )

    expect(result).toEqual({ id: "order_1" })
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(authorize.mock.calls[0][0]).toMatchObject({ context: { idempotency_key: SESSION_ID } })
    expect(client.settlePayment).toHaveBeenCalledTimes(1)
    expect(client.settlePayment.mock.calls[0][0].paymentPayload.payload.signature).toBe("0xsig")
    expect(sessions.get(SESSION_ID)).toMatchObject({ status: "authorized", data: { prism_tx_id: "0xtx", eip3009_authorization: null } })
    expect(JSON.stringify(sessions.get(SESSION_ID))).not.toContain(handed)
    expect(order.createOrders).toHaveBeenCalledTimes(1)
    expect(agentSessions.rows.get("cart_1")?.pending_settlement?.provider_called_at).toEqual(expect.any(String))
  })

  it("declines the same completion when it runs without the handoff, so nothing settles", async () => {
    const { container, payment } = containerFor(sessions, agentSessionsSettling(), provider)
    await createPrismSession(payment, { prism_checkout_data: checkoutData, credential_sha256: credentialSha256(handed), x402_version: 2 })

    const run = agentCheckout(container).run({ input: { cart_id: "cart_1" }, throwOnError: true })

    await expect(run).rejects.toThrow(/was not authorized with the provider/)
    expect(client.settlePayment).not.toHaveBeenCalled()
    expect(sessions.get(SESSION_ID)?.data).toMatchObject({ error: "credential_handoff_missing", settlement_state: "declined" })
  })

  it("refuses a native completion of a shopper cart that carries a forged Prism settlement", async () => {
    const { container, payment, order } = containerFor(sessions, fakeAgentSessions([]), provider)
    await createPrismSession(payment, {
      prism_checkout_data: checkoutData,
      prism_tx_id: "0xforged",
      transaction_network: NETWORK,
      settled_asset: credential().paymentPayload.accepted,
      settled_amount: "1500000",
      captured: true,
    })
    const authorize = vi.spyOn(provider, "authorizePayment")

    const error = await completeCartWorkflow(container).run({ input: { id: "cart_1" }, throwOnError: true }).catch((caught: unknown) => caught)

    expect((error as { code?: unknown }).code).toBe(AGENT_CHECKOUT_REQUIRED)
    expect(authorize).not.toHaveBeenCalled()
    expect(order.createOrders).not.toHaveBeenCalled()
    expect(sessions.get(SESSION_ID)?.data).toMatchObject({ prism_tx_id: null, captured: null })
  })
})
