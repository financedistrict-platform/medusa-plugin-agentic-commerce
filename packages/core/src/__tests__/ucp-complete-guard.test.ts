import { describe, it, expect } from "vitest"
import {
  checkPrismInstrument,
  checkQuoteBinding,
  formatZodIssuePath,
  isPrismProvider,
} from "../lib/ucp-complete-guard"

const HANDLER_ID = "xyz.fd.prism_payment"

const credential = {
  type: "x402",
  x402Version: 2,
  paymentPayload: {
    accepted: { network: "eip155:84532", asset: "0xAsset" },
    payload: {
      authorization: { value: "1500000", to: "0xMerchant" },
    },
  },
  paymentRequirements: { scheme: "exact" },
}

const instrument = { id: "inst_1", handler_id: HANDLER_ID, type: "x402", credential }

const quotedMetadata = {
  prism_checkout_data: {
    ucp: {
      [HANDLER_ID]: [{
        id: HANDLER_ID,
        version: "2026-10-07",
        config: {
          x402Version: 2,
          accepts: [{ network: "eip155:84532", asset: "0xasset", amount: "1500000", payTo: "0xmerchant" }],
        },
      }],
    },
  },
}

describe("isPrismProvider", () => {
  it("matches Medusa ids of the prism provider", () => {
    expect(isPrismProvider("pp_prism_prism")).toBe(true)
    expect(isPrismProvider("pp_system_default")).toBe(false)
  })
})

describe("checkPrismInstrument", () => {
  it("accepts the contract instrument", () => {
    expect(checkPrismInstrument(instrument)).toBeNull()
  })

  it.each([
    ["an unknown handler_id", { ...instrument, handler_id: "x402" }],
    ["instrument type tokenized", { ...instrument, type: "tokenized" }],
    ["credential type tokenized", { ...instrument, credential: { ...credential, type: "tokenized" } }],
    ["a missing credential", { ...instrument, credential: undefined }],
  ])("rejects %s with 422 invalid_instrument", (_label, input) => {
    expect(checkPrismInstrument(input)).toMatchObject({ status: 422, code: "invalid_instrument" })
  })
})

describe("checkQuoteBinding", () => {
  it("passes when the signed payment matches the stored quote", () => {
    expect(checkQuoteBinding(quotedMetadata, HANDLER_ID, credential)).toBeNull()
  })

  it("skips carts without a Prism quote", () => {
    expect(checkQuoteBinding({}, HANDLER_ID, credential)).toBeNull()
    expect(checkQuoteBinding(undefined, undefined, credential)).toBeNull()
  })

  it("rejects when the quote exists but the handler_id finds no stored accepts", () => {
    expect(checkQuoteBinding(quotedMetadata, "x402", credential))
      .toMatchObject({ status: 422, code: "no_payment_quote" })
  })

  it("rejects when the quote exists but holds no UCP accepts", () => {
    expect(checkQuoteBinding({ prism_checkout_data: { ucp: null } }, HANDLER_ID, credential))
      .toMatchObject({ status: 422, code: "no_payment_quote" })
  })

  it("rejects when the quote exists but the credential cannot be read", () => {
    expect(checkQuoteBinding(quotedMetadata, HANDLER_ID, { type: "x402" }))
      .toMatchObject({ status: 422, code: "invalid_credential" })
  })

  it("rejects a signed amount that differs from the quote", () => {
    const tampered = {
      ...credential,
      paymentPayload: {
        ...credential.paymentPayload,
        payload: { authorization: { value: "1", to: "0xMerchant" } },
      },
    }
    expect(checkQuoteBinding(quotedMetadata, HANDLER_ID, tampered))
      .toMatchObject({ status: 422, code: "amount_mismatch" })
  })
})

describe("formatZodIssuePath", () => {
  it("joins the first issue path", () => {
    expect(formatZodIssuePath([{ path: ["payment", "instruments", 0, "type"] }])).toBe("payment.instruments.0.type")
  })

  it("falls back to body for root issues", () => {
    expect(formatZodIssuePath([])).toBe("body")
  })
})
