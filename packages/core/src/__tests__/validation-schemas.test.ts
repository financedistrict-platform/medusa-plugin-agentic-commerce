import { describe, it, expect } from "vitest"
import { CompleteUcpCheckoutSessionSchema } from "../api/validation-schemas"

describe("CompleteUcpCheckoutSessionSchema", () => {
  // =========================================================
  // UCP spec format: payment.instruments[]
  // =========================================================

  describe("UCP spec format (payment.instruments[])", () => {
    it("accepts the exact request body from the UCP spec", () => {
      const body = {
        payment: {
          instruments: [{
            id: "test_instrument_001",
            handler_id: "x402",
            type: "default",
            credential: {
              type: "default",
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
            },
          }],
        },
      }

      const result = CompleteUcpCheckoutSessionSchema.safeParse(body)
      expect(result.success).toBe(true)
    })

    it("accepts minimal instrument with just credential.authorization", () => {
      const body = {
        payment: {
          instruments: [{
            credential: {
              authorization: "base64-encoded-auth",
            },
          }],
        },
      }

      const result = CompleteUcpCheckoutSessionSchema.safeParse(body)
      expect(result.success).toBe(true)
    })

    it("accepts instrument with all optional fields", () => {
      const body = {
        payment: {
          instruments: [{
            id: "inst_001",
            handler_id: "prism_default",
            type: "default",
            credential: {
              authorization: "auth-data",
              x402_version: 2,
              extra_field: "allowed by z.record",
            },
          }],
        },
      }

      const result = CompleteUcpCheckoutSessionSchema.safeParse(body)
      expect(result.success).toBe(true)
    })

    it("accepts multiple instruments", () => {
      const body = {
        payment: {
          instruments: [
            { id: "inst_1", credential: { authorization: "auth1" } },
            { id: "inst_2", credential: { authorization: "auth2" } },
          ],
        },
      }

      const result = CompleteUcpCheckoutSessionSchema.safeParse(body)
      expect(result.success).toBe(true)
    })

    it("rejects payment with empty instruments array", () => {
      const body = {
        payment: {
          instruments: [],
        },
      }

      const result = CompleteUcpCheckoutSessionSchema.safeParse(body)
      expect(result.success).toBe(false)
    })

    it("rejects the old payment_credentials field", () => {
      const body = {
        payment_credentials: {
          handler: "xyz.fd.prism_payment",
          token: "some-token",
        },
      }

      const result = CompleteUcpCheckoutSessionSchema.safeParse(body)
      // Schema parses OK (unknown keys stripped) but payment is absent
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payment).toBeUndefined()
      }
    })
  })

  // =========================================================
  // Empty / optional body
  // =========================================================

  describe("optional payment", () => {
    it("accepts empty body (route handler enforces the requirement)", () => {
      const result = CompleteUcpCheckoutSessionSchema.safeParse({})
      expect(result.success).toBe(true)
    })
  })

  // =========================================================
  // Regression: the exact request body from the bug report
  // =========================================================

  describe("regression: original failing request", () => {
    it("accepts the exact request body that was previously rejected", () => {
      const body = {
        payment: {
          instruments: [{
            id: "test_instrument_001",
            handler_id: "x402",
            type: "default",
            credential: {
              type: "default",
              x402Version: 2,
            },
          }],
        },
      }

      const result = CompleteUcpCheckoutSessionSchema.safeParse(body)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payment?.instruments).toHaveLength(1)
        expect(result.data.payment?.instruments[0].handler_id).toBe("x402")
      }
    })
  })
})
