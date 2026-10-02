import { standardUcpError, withSupportedVersions, type UcpCapability, type UcpErrorInput, type UcpProfileInput, type UcpWire } from "./types"

const VERSION = "2026-04-08"
const LEGACY_PAYMENT_HANDLER_ID = "prism_default"

export const wire20260408: UcpWire = {
  version: VERSION,
  lineItemTotalType: "line_total",

  profile(input: UcpProfileInput) {
    const ucp = {
      version: VERSION,
      services: {
        "dev.ucp.shopping": [{
          version: VERSION,
          transport: "rest",
          endpoint: `${input.requestBaseUrl}/ucp`,
        }],
      },
      capabilities: {
        "dev.ucp.shopping.catalog.search": [{ version: VERSION }],
        "dev.ucp.shopping.catalog.lookup": [{ version: VERSION }],
        "dev.ucp.shopping.checkout": [{ version: VERSION }],
        "dev.ucp.shopping.cart": [{ version: VERSION }],
        "dev.ucp.shopping.order": [{ version: VERSION }],
      },
      payment_handlers: input.handlers,
    }
    return { ucp: withSupportedVersions(ucp, input.supportedVersions) }
  },

  envelopeCapabilities() {
    return {
      "dev.ucp.shopping.catalog.search": [{ version: VERSION }],
      "dev.ucp.shopping.catalog.lookup": [{ version: VERSION }],
      "dev.ucp.shopping.checkout": [{ version: VERSION }],
      "dev.ucp.shopping.cart": [{ version: VERSION }],
      "dev.ucp.shopping.order": [{ version: VERSION }],
      "dev.ucp.shopping.fulfillment": [{ version: VERSION }],
    }
  },

  checkoutHandlers(handlers: Record<string, unknown[]>) {
    return handlers
  },

  error(input: UcpErrorInput) {
    return standardUcpError(VERSION, input)
  },

  supports(_capability: UcpCapability) {
    return true
  },

  completedPaymentHandlerId(handlerId: string | undefined) {
    return handlerId || LEGACY_PAYMENT_HANDLER_ID
  },
}
