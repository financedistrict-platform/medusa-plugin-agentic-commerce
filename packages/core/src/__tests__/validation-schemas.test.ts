import { describe, it, expect } from "vitest"
import { CompleteUcpCheckoutSessionSchema } from "../api/validation-schemas"

const credential = {
  type: "x402",
  x402Version: 2,
  paymentPayload: {
    signature: "0xabc123",
    authorization: {
      from: "0xAgentWallet",
      to: "0xMerchant",
      value: "120000000",
      validAfter: "0",
      validBefore: "1760000000",
      nonce: "0xdef456",
    },
  },
  paymentRequirements: {
    scheme: "exact",
    network: "eip155:8453",
  },
}

const instrument = {
  id: "inst_1",
  handler_id: "xyz.fd.prism_payment",
  type: "x402",
  credential,
}

function parse(body: unknown) {
  return CompleteUcpCheckoutSessionSchema.safeParse(body)
}

function issuePath(body: unknown): string {
  const result = parse(body)
  if (result.success) throw new Error("expected a validation failure")
  return result.error.issues[0].path.join(".")
}

describe("CompleteUcpCheckoutSessionSchema", () => {
  it("accepts the contract instrument", () => {
    const result = parse({ payment: { instruments: [instrument] } })
    expect(result.success).toBe(true)
    if (result.success) {
      const parsed = result.data.payment!.instruments[0]
      expect(parsed.handler_id).toBe("xyz.fd.prism_payment")
      expect(parsed.credential).toEqual(credential)
    }
  })

  it("accepts multiple instruments", () => {
    const result = parse({
      payment: { instruments: [instrument, { ...instrument, id: "inst_2" }] },
    })
    expect(result.success).toBe(true)
  })

  it("accepts an instrument without a credential", () => {
    const { credential: _omit, ...withoutCredential } = instrument
    expect(parse({ payment: { instruments: [withoutCredential] } }).success).toBe(true)
  })

  it.each(["id", "handler_id", "type"] as const)("rejects an instrument without %s", (field) => {
    const { [field]: _omit, ...rest } = instrument
    expect(issuePath({ payment: { instruments: [rest] } })).toBe(`payment.instruments.0.${field}`)
  })

  it("rejects a credential without type", () => {
    const { type: _omit, ...untyped } = credential
    expect(issuePath({ payment: { instruments: [{ ...instrument, credential: untyped }] } }))
      .toBe("payment.instruments.0.credential.type")
  })

  it("rejects payment with an empty instruments array", () => {
    expect(parse({ payment: { instruments: [] } }).success).toBe(false)
  })

  it("strips the removed payment_credentials field", () => {
    const result = parse({ payment_credentials: { authorization: "x" } })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty("payment_credentials")
    }
  })

  it("accepts an empty body so the route can report missing payment", () => {
    expect(parse({}).success).toBe(true)
  })
})
