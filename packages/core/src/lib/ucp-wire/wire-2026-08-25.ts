import { buildUcpProfile } from "../ucp-profile"
import { standardUcpError, withSupportedVersions, type UcpCapability, type UcpErrorInput, type UcpProfileInput, type UcpWire } from "./types"

const VERSION = "2026-08-25"

export const wire20260825: UcpWire = {
  version: VERSION,
  lineItemTotalType: "line_total",

  profile(input: UcpProfileInput) {
    const profile = buildUcpProfile(VERSION, input.publicBaseUrl, input.storeName, input.handlers)
    return { ...profile, ucp: withSupportedVersions(profile.ucp, input.supportedVersions) }
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
    return handlerId
  },
}
