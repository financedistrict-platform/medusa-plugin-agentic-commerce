import { describe, it, expect } from "vitest"
import { CompleteUcpCheckoutSessionSchema } from "../api/validation-schemas"
import {
  checkPrismInstrument,
  checkQuoteBinding,
  normalizePrismHandlerId,
  PRISM_UCP_HANDLER_ID,
} from "../lib/ucp-complete-guard"
import { extractSignedSummary } from "../lib/validate-signed-amount"

const toBase64 = (credential: unknown) => Buffer.from(JSON.stringify(credential)).toString("base64")

const credential = {
  type: "x402",
  x402Version: 2,
  paymentPayload: {
    accepted: { network: "eip155:84532", asset: "0xAsset", amount: "1500000", payTo: "0xMerchant" },
    payload: { authorization: { from: "0x2222222222222222222222222222222222222222", nonce: "0x0101010101010101010101010101010101010101010101010101010101010101", value: "1500000", to: "0xMerchant" } },
  },
  paymentRequirements: { scheme: "exact" },
}
const { type: _type, ...untypedCredential } = credential

const storedQuote = {
  ucp: {
    [PRISM_UCP_HANDLER_ID]: [{
      id: "x402",
      version: "2026-01-15",
      config: {
        x402Version: 2,
        accepts: [{ network: "eip155:84532", asset: "0xasset", amount: "1500000", payTo: "0xmerchant" }],
      },
    }],
  },
}

describe("original-era instruments", () => {
  it.each([
    ["handler_id xyz.fd.prism_payment, type tokenized, no id, untyped credential", { handler_id: PRISM_UCP_HANDLER_ID, type: "tokenized", credential: untypedCredential }],
    ["handler_id x402, no type", { handler_id: "x402", credential }],
    ["handler_id missing, type default", { type: "default", credential }],
    ["handler_id missing, type tokenized", { type: "tokenized", credential: untypedCredential }],
    ["the current contract instrument", { id: "inst_1", handler_id: PRISM_UCP_HANDLER_ID, type: "x402", credential }],
  ])("accepts %s", (_label, instrument) => {
    expect(CompleteUcpCheckoutSessionSchema.safeParse({ payment: { instruments: [instrument] } }).success).toBe(true)
    expect(checkPrismInstrument(instrument)).toBeNull()
  })

  it.each([
    ["another handler", { handler_id: "com.other.pay", type: "x402", credential }],
    ["a card instrument", { handler_id: PRISM_UCP_HANDLER_ID, type: "card", credential }],
    ["a tokenized credential", { handler_id: PRISM_UCP_HANDLER_ID, type: "x402", credential: { ...credential, type: "tokenized" } }],
    ["no credential", { handler_id: PRISM_UCP_HANDLER_ID, type: "x402" }],
  ])("rejects %s with 422 invalid_instrument", (_label, instrument) => {
    expect(checkPrismInstrument(instrument)).toMatchObject({ status: 422, code: "invalid_instrument" })
  })
})

describe("quote binding with original-era handler ids", () => {
  it.each([PRISM_UCP_HANDLER_ID, "x402", undefined])("finds the stored quote for handler_id %s", (handlerId) => {
    expect(normalizePrismHandlerId(handlerId)).toBe(PRISM_UCP_HANDLER_ID)
    expect(checkQuoteBinding(storedQuote, handlerId, extractSignedSummary(toBase64(credential)))).toBeNull()
  })

  it("keeps rejecting a tampered amount for an original-era instrument", () => {
    const tampered = { ...credential, paymentPayload: { ...credential.paymentPayload, payload: { authorization: { from: "0x2222222222222222222222222222222222222222", nonce: "0x0101010101010101010101010101010101010101010101010101010101010101", value: "1", to: "0xMerchant" } } } }
    expect(checkQuoteBinding(storedQuote, "x402", extractSignedSummary(toBase64(tampered)))).toMatchObject({ status: 422, code: "amount_mismatch" })
  })

  it("does not map other handler ids onto the Prism quote", () => {
    expect(normalizePrismHandlerId("com.other.pay")).toBe("com.other.pay")
    expect(checkQuoteBinding(storedQuote, "com.other.pay", extractSignedSummary(toBase64(credential)))).toMatchObject({ status: 422, code: "no_payment_quote" })
  })
})
