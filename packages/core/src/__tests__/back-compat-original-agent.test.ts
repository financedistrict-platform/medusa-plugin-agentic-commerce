import { describe, it, expect } from "vitest"
import middlewares from "../api/middlewares"
import { CompleteUcpCheckoutSessionSchema } from "../api/validation-schemas"
import AgenticCommerceService from "../modules/agentic-commerce/service"
import { extractUcpPayment } from "../lib/extract-ucp-payment"
import { checkPrismInstrument, checkQuoteBinding, isPrismProvider } from "../lib/ucp-complete-guard"
import { ucpErrorFor, ucpVersionFor, ucpWireFor } from "../lib/ucp-version"
import { readFixture } from "./helpers/render-wire"

type Middleware = (req: any, res: any, next: () => void) => Promise<void>

function middlewareOf(matcher: string, name: string): Middleware {
  const route = (middlewares as any).routes.find((r: any) => r.matcher === matcher && r.middlewares.some((m: Middleware) => m.name === name))
  if (!route) throw new Error(`${name} is not registered on ${matcher}`)
  return route.middlewares.find((m: Middleware) => m.name === name)
}

function originalRequest(headers: Record<string, string>) {
  const service = new AgenticCommerceService({}, { store_name: "Demo Store", payment_provider_id: "pp_prism_prism", ucp_version: "2026-04-08" })
  const services: Record<string, unknown> = { agenticCommerce: service, logger: { warn: () => undefined } }
  return { headers, path: "/ucp/checkout-sessions/cart_01/complete", params: { id: "cart_01" }, scope: { resolve: (n: string) => services[n] } } as any
}

const originalBody = {
  payment: {
    instruments: [{
      handler_id: "xyz.fd.prism_payment",
      type: "tokenized",
      credential: {
        x402Version: 2,
        paymentPayload: {
          accepted: { network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "1000000", payTo: "0x1111111111111111111111111111111111111111" },
          payload: { authorization: { from: "0x2222222222222222222222222222222222222222", nonce: "0x0101010101010101010101010101010101010101010101010101010101010101", value: "1000000", to: "0x1111111111111111111111111111111111111111" } },
        },
      },
    }],
  },
}

const originalQuote = JSON.parse(readFixture("inputs", "checkout-session.json")).cart.agent_session.handler_data["xyz.fd.prism_payment"]

describe("an agent built against 0.1.12", () => {
  it("is served 2026-04-08 when UCP-Agent carries no profile", async () => {
    const req = originalRequest({ "ucp-agent": "agent/1.0", "request-id": "req-1" })
    let nextCalled = false
    await middlewareOf("/ucp/checkout-sessions*", "resolveUcpVersionMiddleware")(req, {}, () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(ucpVersionFor(req)).toBe("2026-04-08")
    expect(req.ucp.outcome).toBe("none")
  })

  it("gets the original error shape", () => {
    const req = originalRequest({ "ucp-agent": "agent/1.0" })
    expect(JSON.stringify(ucpErrorFor(req, { code: "invalid_instrument", content: "handler_id must be xyz.fd.prism_payment", severity: "unrecoverable" }), null, 2))
      .toBe(readFixture("2026-04-08", "error__invalid_instrument.json"))
  })

  it("completes an original instrument through validation, the Prism guard and quote binding", () => {
    const parsed = CompleteUcpCheckoutSessionSchema.safeParse(originalBody)
    expect(parsed.success).toBe(true)
    const extraction = extractUcpPayment(parsed.data!)
    if (!extraction.ok) throw new Error(extraction.code)
    const extracted = extraction.payment
    expect(extracted).toMatchObject({ handlerId: "xyz.fd.prism_payment", instrumentType: "tokenized" })
    expect(isPrismProvider("pp_prism_prism")).toBe(true)
    expect(checkPrismInstrument(parsed.data!.payment!.instruments[0])).toBeNull()
    expect(checkQuoteBinding(originalQuote, extracted.handlerId, extracted.signedSummary)).toBeNull()
  })

  it("completes an instrument without handler_id and reports prism_default as 0.1.12 did", () => {
    const { handler_id: _omit, ...instrument } = originalBody.payment.instruments[0]
    const parsed = CompleteUcpCheckoutSessionSchema.safeParse({ payment: { instruments: [instrument] } })
    expect(parsed.success).toBe(true)
    const extraction = extractUcpPayment(parsed.data!)
    if (!extraction.ok) throw new Error(extraction.code)
    const extracted = extraction.payment
    expect(checkPrismInstrument(parsed.data!.payment!.instruments[0])).toBeNull()
    expect(checkQuoteBinding(originalQuote, extracted.handlerId, extracted.signedSummary)).toBeNull()
    expect(ucpWireFor(originalRequest({})).completedPaymentHandlerId(extracted.handlerId)).toBe("prism_default")
  })

  it("rejects another handler id with 422 invalid_instrument", () => {
    const instrument = { ...originalBody.payment.instruments[0], handler_id: "other" }
    expect(checkPrismInstrument(instrument)).toMatchObject({ status: 422, code: "invalid_instrument" })
  })
})
