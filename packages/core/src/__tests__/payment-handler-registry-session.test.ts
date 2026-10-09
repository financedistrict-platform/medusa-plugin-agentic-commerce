import { describe, it, expect, vi } from "vitest"
import { PaymentHandlerRegistry } from "../lib/payment-handler-registry"
import { fakeAgentSessions } from "./helpers/agent-session-store"
import type { PaymentHandlerAdapter } from "../types/payment-handler-adapter"

function adapter(id: string, prepare: PaymentHandlerAdapter["prepareCheckoutPayment"]): PaymentHandlerAdapter {
  return {
    id,
    name: id,
    getUcpDiscoveryHandlers: async () => ({}),
    getAcpDiscoveryHandlers: async () => [],
    prepareCheckoutPayment: prepare,
    getUcpCheckoutHandlers: (stored) => (stored ? { [id]: [stored] } : {}),
    getAcpCheckoutHandlers: (stored) => (stored ? [stored] : []),
  }
}

function prepareInput(sessions: ReturnType<typeof fakeAgentSessions>, agentSession: unknown) {
  return {
    cart: { id: "cart_1", agent_session: agentSession } as never,
    checkoutBaseUrl: "https://shop.test/ucp/checkout-sessions",
    storeName: "Shop",
    ucpVersion: "2026-04-08",
    container: { resolve: () => sessions },
  }
}

describe("payment handler registry", () => {
  it("keeps what each adapter returned in the agent session and hands it back next time", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1" }])
    const prism = vi.fn(async (input: { stored?: unknown }) => ({ quote: "q1", previous: input.stored ?? null }))
    const other = vi.fn(async () => ({ other: true }))
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter(adapter("prism", prism))
    registry.registerAdapter(adapter("other", other))

    await registry.prepareCheckoutPayment(prepareInput(sessions, { handler_data: {} }))
    expect(sessions.rows.get("cart_1")!.handler_data).toEqual({ prism: { quote: "q1", previous: null }, other: { other: true } })

    await registry.prepareCheckoutPayment(prepareInput(sessions, sessions.rows.get("cart_1")))
    expect(prism).toHaveBeenLastCalledWith(expect.objectContaining({ stored: { quote: "q1", previous: null } }))
    expect(other).toHaveBeenLastCalledWith(expect.objectContaining({ stored: { other: true } }))
  })

  it("replaces the stored data with null when an adapter could not prepare", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", handler_data: { prism: { quote: "stale" } } }])
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter(adapter("prism", async () => null))

    await registry.prepareCheckoutPayment(prepareInput(sessions, sessions.rows.get("cart_1")))

    expect(sessions.rows.get("cart_1")!.handler_data).toEqual({ prism: null })
  })

  it("stores null for an adapter that threw, in the same write as the other adapters", async () => {
    const sessions = fakeAgentSessions([{ cart_id: "cart_1", handler_data: { prism: { quote: "stale" } } }])
    const write = vi.spyOn(sessions, "storeHandlerData")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter(adapter("prism", async () => { throw new Error("gateway down") }))
    registry.registerAdapter(adapter("other", async () => ({ other: true })))

    await registry.prepareCheckoutPayment(prepareInput(sessions, sessions.rows.get("cart_1")))

    expect(write).toHaveBeenCalledTimes(1)
    expect(sessions.rows.get("cart_1")!.handler_data).toEqual({ prism: null, other: { other: true } })
    vi.restoreAllMocks()
  })

  it("fails loudly when the cart has no agent session to keep the quote in", async () => {
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter(adapter("prism", async () => ({ quote: "q1" })))

    await expect(registry.prepareCheckoutPayment(prepareInput(fakeAgentSessions([]), undefined))).rejects.toThrow("session cart_1 not found")
  })

  it("gives each adapter only its own stored data when formatting a response", () => {
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter(adapter("prism", async () => null))
    registry.registerAdapter(adapter("other", async () => null))

    const handlerData = { prism: { quote: "q1" }, other: { other: true } }

    expect(registry.getUcpCheckoutHandlers(handlerData)).toEqual({ prism: [{ quote: "q1" }], other: [{ other: true }] })
    expect(registry.getAcpCheckoutHandlers({ prism: { quote: "q1" } })).toEqual([{ quote: "q1" }])
    expect(registry.getAcpCheckoutHandlers()).toEqual([])
  })
})
