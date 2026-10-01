import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import * as core from "../index"
import * as prism from "../../../prism-payment/src/index"

const CORE_VALUES = [
  "AgenticCommerceModule", "AGENTIC_COMMERCE_MODULE", "PaymentHandlerRegistry", "AgenticCommerceService",
  "getPublicBaseUrl", "formatAcpError", "formatUcpError", "CHECKOUT_SESSION_CART_FIELDS", "CART_VALIDATION_FIELDS",
  "ORDER_FIELDS", "medusaToAcpAddress", "acpAddressToMedusa", "medusaToUcpAddress", "ucpAddressToMedusa",
  "resolveAcpStatus", "resolveUcpStatus",
]
const CORE_TYPES = ["PaymentHandlerAdapter", "CheckoutPrepareInput", "AgenticCommerceOptions", "AcpErrorResponse", "UcpErrorResponse"]

const PRISM_VALUES = [
  "PrismPaymentHandlerModule", "PRISM_PAYMENT_HANDLER_MODULE", "PrismPaymentHandlerAdapter", "PRISM_CHECKOUT_DATA_KEY",
  "PRISM_CHECKOUT_CONFIG_KEY", "PrismPaymentProvider", "PrismClient", "PRISM_HANDLER_ID", "PRISM_INSTRUMENT_SCHEMA",
]
const PRISM_TYPES = [
  "PrismPaymentHandlerOptions", "PrismClientOptions", "PreparePaymentInput", "UcpHandlerDiscoveryEntry",
  "UcpHandlersDiscoveryResponse", "UcpCheckoutHandlerEntry", "UcpCheckoutPrepareResponse", "AcpHandler",
  "PaymentHandlerConfig", "X402AcceptEntry", "PrismPaymentConfig", "X402PaymentAuthorization", "Eip3009Authorization",
  "PrismSettleResponse", "PrismVerifyResponse",
]

function exportedNames(indexPath: string): Set<string> {
  const source = readFileSync(indexPath, "utf8")
  const names = new Set<string>()
  for (const block of source.matchAll(/export (?:type )?\{([^}]*)\}/g)) {
    for (const part of block[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) names.add(name)
    }
  }
  return names
}

describe("public API of @financedistrict/medusa-plugin-agentic-commerce", () => {
  it.each(CORE_VALUES)("still exports %s", (name) => {
    expect((core as Record<string, unknown>)[name]).toBeDefined()
  })

  it("still declares every type export of 0.1.12 and 1.0.0", () => {
    const names = exportedNames(join(__dirname, "..", "index.ts"))
    for (const name of [...CORE_VALUES, ...CORE_TYPES]) expect(names.has(name), name).toBe(true)
  })

  it("adds the version registry", () => {
    expect(typeof core.createUcpVersionRegistry).toBe("function")
    expect(core.DEFAULT_CURRENT_UCP_VERSION).toBe("2026-04-08")
  })
})

describe("public API of @financedistrict/medusa-plugin-prism-payment", () => {
  it.each(PRISM_VALUES)("still exports %s", (name) => {
    expect((prism as Record<string, unknown>)[name]).toBeDefined()
  })

  it("still declares every type export of 0.3.3 and 1.0.0", () => {
    const names = exportedNames(join(__dirname, "..", "..", "..", "prism-payment", "src", "index.ts"))
    for (const name of [...PRISM_VALUES, ...PRISM_TYPES]) expect(names.has(name), name).toBe(true)
  })
})
