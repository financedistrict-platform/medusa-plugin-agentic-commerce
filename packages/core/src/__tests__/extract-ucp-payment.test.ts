import { describe, it, expect } from "vitest"
import { extractUcpPayment } from "../lib/extract-ucp-payment"

describe("extractUcpPayment", () => {
  // =========================================================
  // UCP spec format: payment.instruments[]
  // =========================================================

  describe("UCP spec format (payment.instruments[])", () => {
    it("extracts authorization from instrument credential", () => {
      const result = extractUcpPayment({
        payment: {
          instruments: [{
            id: "inst_001",
            handler_id: "xyz.fd.prism_payment",
            type: "x402",
            credential: {
              type: "x402",
              authorization: "base64-encoded-auth-data",
              x402_version: 2,
            },
          }],
        },
      })

      expect(result).toEqual({
        eip3009Authorization: "base64-encoded-auth-data",
        x402Version: 2,
        handlerId: "xyz.fd.prism_payment",
        instrumentType: "x402",
      })
    })

    it("extracts from full x402 paymentPayload structure", () => {
      const credential = {
        type: "x402",
        paymentPayload: {
          signature: "0xabc",
          authorization: {
            from: "0xAgent",
            to: "0xMerchant",
            value: "120000000",
            validAfter: "0",
            validBefore: "1760000000",
            nonce: "0xdef",
          },
        },
        paymentRequirements: { scheme: "exact" },
        x402Version: 2,
      }

      const result = extractUcpPayment({
        payment: {
          instruments: [{
            id: "inst_002",
            handler_id: "xyz.fd.prism_payment",
            type: "x402",
            credential,
          }],
        },
      })

      expect(result).not.toBeNull()
      // Should base64-encode the entire credential
      const decoded = JSON.parse(Buffer.from(result!.eip3009Authorization, "base64").toString("utf-8"))
      expect(decoded.paymentPayload.signature).toBe("0xabc")
      expect(decoded.paymentRequirements.scheme).toBe("exact")
      expect(result!.x402Version).toBe(2)
      expect(result!.handlerId).toBe("xyz.fd.prism_payment")
      expect(result!.instrumentType).toBe("x402")
    })

    it("uses first instrument when multiple are provided", () => {
      const result = extractUcpPayment({
        payment: {
          instruments: [
            {
              id: "inst_first",
              handler_id: "handler_a",
              type: "x402",
              credential: { authorization: "auth-first" },
            },
            {
              id: "inst_second",
              handler_id: "handler_b",
              type: "x402",
              credential: { authorization: "auth-second" },
            },
          ],
        },
      })

      expect(result!.eip3009Authorization).toBe("auth-first")
      expect(result!.handlerId).toBe("handler_a")
    })

    it("returns null when instrument has no credential", () => {
      const result = extractUcpPayment({
        payment: {
          instruments: [{
            id: "inst_003",
            handler_id: "xyz.fd.prism_payment",
            type: "x402",
          }],
        },
      })

      expect(result).toBeNull()
    })

    it("returns null when credential has no authorization or paymentPayload", () => {
      const result = extractUcpPayment({
        payment: {
          instruments: [{
            id: "inst_004",
            handler_id: "xyz.fd.prism_payment",
            type: "x402",
            credential: { type: "x402" },
          }],
        },
      })

      expect(result).toBeNull()
    })

    it("handles optional fields gracefully", () => {
      const result = extractUcpPayment({
        payment: {
          instruments: [{
            credential: { authorization: "auth-minimal" },
          }],
        },
      })

      expect(result).toEqual({
        eip3009Authorization: "auth-minimal",
        x402Version: undefined,
        handlerId: undefined,
      })
    })
  })

  // =========================================================
  // Edge cases
  // =========================================================

  describe("edge cases", () => {
    it("returns null for empty body", () => {
      expect(extractUcpPayment({})).toBeNull()
    })

    it("returns null for body with no payment fields", () => {
      expect(extractUcpPayment({ foo: "bar" })).toBeNull()
    })

    it("returns null for payment with empty instruments array", () => {
      expect(extractUcpPayment({ payment: { instruments: [] } })).toBeNull()
    })

    it("returns null for payment without instruments key", () => {
      expect(extractUcpPayment({ payment: {} })).toBeNull()
    })
  })
})
