import { buildUcpProfile, UCP_PROFILE_CAPABILITIES } from "../ucp-profile"
import type { UcpCapability, UcpErrorInput, UcpProfileInput, UcpWire } from "./types"

const VERSION = "2026-01-23"
const LATER_HANDLER_FIELDS = ["available_instruments"]
const SUPPORTED_CAPABILITIES: UcpCapability[] = ["checkout", "order"]
const PROFILE_CAPABILITY_NAMES = ["dev.ucp.shopping.checkout", "dev.ucp.shopping.fulfillment", "dev.ucp.shopping.order"]
const PROFILE_CAPABILITIES = UCP_PROFILE_CAPABILITIES.filter((capability) => PROFILE_CAPABILITY_NAMES.includes(capability.name))

function withoutLaterFields(handlers: Record<string, unknown[]>): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {}
  for (const [namespace, entries] of Object.entries(handlers)) {
    result[namespace] = entries.map((entry) => {
      if (typeof entry !== "object" || entry === null) return entry
      const copy = { ...(entry as Record<string, unknown>) }
      for (const field of LATER_HANDLER_FIELDS) delete copy[field]
      return copy
    })
  }
  return result
}

export const wire20260123: UcpWire = {
  version: VERSION,
  lineItemTotalType: "subtotal",

  profile(input: UcpProfileInput) {
    return buildUcpProfile(VERSION, input.publicBaseUrl, input.storeName, withoutLaterFields(input.handlers), PROFILE_CAPABILITIES, "openapi.json")
  },

  envelopeCapabilities() {
    return {
      "dev.ucp.shopping.checkout": [{ version: VERSION }],
      "dev.ucp.shopping.order": [{ version: VERSION }],
      "dev.ucp.shopping.fulfillment": [{ version: VERSION }],
    }
  },

  checkoutHandlers(handlers: Record<string, unknown[]>) {
    return withoutLaterFields(handlers)
  },

  error(input: UcpErrorInput) {
    return {
      ucp: { version: VERSION },
      status: "requires_escalation",
      messages: [{
        type: "error",
        code: input.code,
        content: input.content,
        severity: !input.severity || input.severity === "unrecoverable" ? "requires_buyer_input" : input.severity,
        ...(input.path ? { path: input.path } : {}),
      }],
    }
  },

  supports(capability: UcpCapability) {
    return SUPPORTED_CAPABILITIES.includes(capability)
  },

  completedPaymentHandlerId(handlerId: string | undefined) {
    return handlerId
  },
}
