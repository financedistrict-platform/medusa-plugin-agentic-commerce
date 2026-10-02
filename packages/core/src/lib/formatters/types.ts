/**
 * Shared types for protocol formatters.
 *
 * Formatters transform Medusa internal objects (carts, orders, products)
 * into ACP or UCP protocol-compliant response shapes. They need store
 * config and the payment handler service to do this.
 */

import type { PaymentHandlerRegistry } from "../payment-handler-registry"
import type { UcpWire } from "../ucp-wire/types"

/** Configuration context passed to all formatters */
export type FormatterContext = {
  storeName: string
  storefrontUrl: string
  ucpWire: UcpWire
  acpVersion: string
  paymentHandlers: PaymentHandlerRegistry
}

/** Convert Medusa amount (fractional units) to minor units (cents) */
export function toMinor(amount: number): number {
  return Math.round(amount * 100)
}
