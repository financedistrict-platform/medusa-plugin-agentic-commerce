/**
 * Regression test for the 100× under-quote bug.
 *
 * Medusa v2 stores cart.total in MAJOR units as a BigNumber (e.g., 17 for
 * €17.00 — NOT 1700 cents). Prism's prepare endpoints expect a decimal
 * string in major units ("15.00" for $15) per prism-client.ts.
 *
 * Earlier code divided cart.total by 100 on the assumption it was in cents,
 * which produced "0.17" → Prism converted that to 170000 raw EURC instead
 * of 17000000 — a 100× under-quote. This test pins the major-unit contract
 * so the bug can't silently regress.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"

describe("PrismPaymentHandlerAdapter.prepareCheckoutPayment — amount unit handling", () => {
  let adapter: PrismPaymentHandlerAdapter
  let prepareUcpSpy: ReturnType<typeof vi.fn>
  let prepareAcpSpy: ReturnType<typeof vi.fn>
  let updateCartsSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = new PrismPaymentHandlerAdapter({}, {})
    prepareUcpSpy = vi.fn().mockResolvedValue({ ok: true })
    prepareAcpSpy = vi.fn().mockResolvedValue({ ok: true })
    updateCartsSpy = vi.fn().mockResolvedValue(undefined)
    // Inject our spies via the private client field — the adapter never
    // re-creates the client after construction.
    ;(adapter as any).client = {
      prepareUcpPayment: prepareUcpSpy,
      prepareAcpPayment: prepareAcpSpy,
    }
  })

  const fakeContainer = () => ({
    resolve: (name: string) => (name === "cart" ? { updateCarts: updateCartsSpy } : null),
  })

  it("forwards cart.total in major units as a decimal string (no /100)", async () => {
    // Medusa v2 cart.total for a €17.00 cart is 17 (major units).
    await adapter.prepareCheckoutPayment({
      cart: { id: "c1", total: 17, currency_code: "eur", metadata: {} } as any,
      checkoutBaseUrl: "https://api.test/ucp/checkout-sessions",
      storeName: "Test",
      container: fakeContainer() as any,
    })
    expect(prepareUcpSpy).toHaveBeenCalledTimes(1)
    // The bug produced "0.17" here; major-unit contract requires "17".
    expect(prepareUcpSpy.mock.calls[0][0].amount).toBe("17")
    expect(prepareAcpSpy.mock.calls[0][0].amount).toBe("17")
  })

  it("preserves fractional major-unit amounts (e.g., 17.50)", async () => {
    await adapter.prepareCheckoutPayment({
      cart: { id: "c2", total: 17.5, currency_code: "usd", metadata: {} } as any,
      checkoutBaseUrl: "https://api.test/ucp/checkout-sessions",
      storeName: "Test",
      container: fakeContainer() as any,
    })
    expect(prepareUcpSpy.mock.calls[0][0].amount).toBe("17.5")
  })

  it("falls back to cart.raw_total.value (also in major units) when cart.total is missing", async () => {
    await adapter.prepareCheckoutPayment({
      cart: { id: "c3", raw_total: { value: "42" }, currency_code: "eur", metadata: {} } as any,
      checkoutBaseUrl: "https://api.test/ucp/checkout-sessions",
      storeName: "Test",
      container: fakeContainer() as any,
    })
    expect(prepareUcpSpy.mock.calls[0][0].amount).toBe("42")
  })

  it("uppercases the cart currency for Prism", async () => {
    await adapter.prepareCheckoutPayment({
      cart: { id: "c4", total: 10, currency_code: "eur", metadata: {} } as any,
      checkoutBaseUrl: "https://api.test/ucp/checkout-sessions",
      storeName: "Test",
      container: fakeContainer() as any,
    })
    expect(prepareUcpSpy.mock.calls[0][0].currency).toBe("EUR")
  })

  it("uses the cart total amount string as the idempotency key (preparedAmount)", async () => {
    const result = await adapter.prepareCheckoutPayment({
      cart: { id: "c5", total: 25, currency_code: "eur", metadata: {} } as any,
      checkoutBaseUrl: "https://api.test/ucp/checkout-sessions",
      storeName: "Test",
      container: fakeContainer() as any,
    })
    expect(result?.preparedAmount).toBe("25")
  })

  it("strips the 20-digit precision suffix on Medusa v2 BigNumber cart.total values", async () => {
    // In production query.graph returns cart.total as a Medusa BigNumber, NOT
    // a plain JS number. Medusa's BigNumber implements Symbol.toPrimitive —
    // hint="string" returns the bignumber.js raw value at 20-digit precision
    // ("34" → "34.000000000000000000"), hint="number" returns the numeric.
    //
    // Without explicit Number() coercion, String(cart.total) sends Prism a
    // 20-digit precision string which it rejects → Promise.allSettled swallows
    // the rejection → cart metadata is never written → the session response
    // renders `payment_handlers: {}` (the "agent has no way to pay" regression).
    //
    // This mock mirrors Medusa BigNumber's Symbol.toPrimitive contract exactly.
    function makeMedusaBigNumber(numeric: number, rawPrecision: string) {
      return {
        numeric,
        raw: { value: rawPrecision, precision: 20 },
        [Symbol.toPrimitive](hint: string) {
          if (hint === "string") return rawPrecision
          return numeric
        },
        valueOf() {
          return numeric
        },
        toJSON() {
          return numeric
        },
      }
    }

    await adapter.prepareCheckoutPayment({
      cart: {
        id: "c-bn",
        total: makeMedusaBigNumber(34, "34.000000000000000000"),
        currency_code: "eur",
        metadata: {},
      } as any,
      checkoutBaseUrl: "https://api.test/ucp/checkout-sessions",
      storeName: "Test",
      container: fakeContainer() as any,
    })

    // Without the Number() coercion this would be "34.000000000000000000".
    expect(prepareUcpSpy.mock.calls[0][0].amount).toBe("34")
    expect(prepareAcpSpy.mock.calls[0][0].amount).toBe("34")
  })

  it("preserves fractional values on Medusa BigNumber (e.g., 17.5)", async () => {
    function makeMedusaBigNumber(numeric: number, rawPrecision: string) {
      return {
        numeric,
        raw: { value: rawPrecision, precision: 20 },
        [Symbol.toPrimitive](hint: string) {
          if (hint === "string") return rawPrecision
          return numeric
        },
        valueOf() {
          return numeric
        },
      }
    }
    await adapter.prepareCheckoutPayment({
      cart: {
        id: "c-bn-frac",
        total: makeMedusaBigNumber(17.5, "17.500000000000000000"),
        currency_code: "usd",
        metadata: {},
      } as any,
      checkoutBaseUrl: "https://api.test/ucp/checkout-sessions",
      storeName: "Test",
      container: fakeContainer() as any,
    })
    expect(prepareUcpSpy.mock.calls[0][0].amount).toBe("17.5")
  })
})
