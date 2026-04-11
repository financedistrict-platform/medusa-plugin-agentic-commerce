/**
 * @financedistrict/medusa-plugin-agentic-commerce
 *
 * Agentic commerce plugin for Medusa v2 — adds UCP and ACP protocol support,
 * enabling AI agents to browse, checkout, and pay at any Medusa storefront.
 *
 * This is the core protocol plugin. Payment handling is pluggable via the
 * PaymentHandlerAdapter interface — install a payment handler plugin
 * (e.g., @financedistrict/medusa-plugin-prism-payment for x402 stablecoins)
 * and reference it in your config.
 *
 * Usage in medusa-config.ts:
 *
 * ```ts
 * export default defineConfig({
 *   modules: [
 *     // 1. Register your payment handler adapter (e.g., Prism for x402 stablecoins)
 *     {
 *       resolve: "@financedistrict/medusa-plugin-prism-payment/modules/prism-payment-handler",
 *       options: {
 *         api_url: process.env.PRISM_API_URL,
 *         api_key: process.env.PRISM_API_KEY,
 *       },
 *     },
 *     // 2. Register the core agentic commerce module
 *     {
 *       resolve: "@financedistrict/medusa-plugin-agentic-commerce/modules/agentic-commerce",
 *       options: {
 *         store_name: "My Store",
 *         storefront_url: process.env.STOREFRONT_URL,
 *         api_key: process.env.AGENTIC_COMMERCE_API_KEY,
 *         payment_handler_adapters: ["prismPaymentHandler"],
 *       },
 *     },
 *   ],
 * })
 * ```
 */

// =====================================================
// Module exports
// =====================================================

export { default as AgenticCommerceModule, AGENTIC_COMMERCE_MODULE } from "./modules/agentic-commerce"

// =====================================================
// Payment Handler Adapter Interface (for plugin authors)
// =====================================================

export type { PaymentHandlerAdapter, CheckoutPrepareInput } from "./types/payment-handler-adapter"
export { PaymentHandlerRegistry } from "./lib/payment-handler-registry"

// =====================================================
// Service exports (for type usage)
// =====================================================

export { default as AgenticCommerceService } from "./modules/agentic-commerce/service"
export type { AgenticCommerceOptions } from "./modules/agentic-commerce/service"

// =====================================================
// Utility exports
// =====================================================

export { getPublicBaseUrl } from "./lib/public-url"
export { formatAcpError, formatUcpError } from "./lib/error-formatters"
export type { AcpErrorResponse, UcpErrorResponse } from "./lib/error-formatters"
export { CHECKOUT_SESSION_CART_FIELDS, CART_VALIDATION_FIELDS } from "./lib/cart-fields"
export { ORDER_FIELDS } from "./lib/order-fields"

// Address translators (useful for payment handler adapters)
export {
  medusaToAcpAddress,
  acpAddressToMedusa,
  medusaToUcpAddress,
  ucpAddressToMedusa,
} from "./lib/address-translator"

// Status maps
export { resolveAcpStatus, resolveUcpStatus } from "./lib/status-maps"
