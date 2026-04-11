/**
 * @financedistrict/medusa-plugin-prism-payment
 *
 * Prism x402 stablecoin payment handler for Medusa agentic commerce.
 *
 * Provides two Medusa modules:
 * 1. prismPaymentHandler — PaymentHandlerAdapter for UCP/ACP discovery + checkout preparation
 * 2. prism (payment provider) — Medusa AbstractPaymentProvider for authorize/capture/settle
 *
 * Usage in medusa-config.ts:
 *
 * ```ts
 * export default defineConfig({
 *   modules: [
 *     // The payment handler adapter (discovery + checkout-prepare)
 *     {
 *       resolve: "@financedistrict/medusa-plugin-prism-payment/modules/prism-payment-handler",
 *       options: {
 *         api_url: process.env.PRISM_API_URL || "https://prism-gw.fd.xyz",
 *         api_key: process.env.PRISM_API_KEY,
 *       },
 *     },
 *     // The Medusa payment provider (authorize/capture/settle)
 *     {
 *       resolve: "@medusajs/medusa/payment",
 *       options: {
 *         providers: [{
 *           resolve: "@financedistrict/medusa-plugin-prism-payment/modules/prism-payment",
 *           id: "prism",
 *           options: {
 *             api_url: process.env.PRISM_API_URL || "https://prism-gw.fd.xyz",
 *             api_key: process.env.PRISM_API_KEY,
 *           },
 *         }],
 *       },
 *     },
 *     // Reference in the agentic commerce plugin
 *     {
 *       resolve: "@financedistrict/medusa-plugin-agentic-commerce/modules/agentic-commerce",
 *       options: {
 *         payment_handler_adapters: ["prismPaymentHandler"],
 *         // ...other options
 *       },
 *     },
 *   ],
 * })
 * ```
 */

// Payment Handler Adapter module
export { default as PrismPaymentHandlerModule, PRISM_PAYMENT_HANDLER_MODULE } from "./modules/prism-payment-handler"
export { default as PrismPaymentHandlerAdapter, PRISM_CHECKOUT_CONFIG_KEY } from "./modules/prism-payment-handler/service"
export type { PrismPaymentHandlerOptions } from "./modules/prism-payment-handler/service"

// Payment Provider module
export { default as PrismPaymentProvider } from "./modules/prism-payment"

// Prism Client
export { PrismClient } from "./lib/prism-client"
export type { PrismClientOptions, CheckoutPrepareInput, CheckoutPrepareResult, X402AcceptEntry } from "./lib/prism-client"

// Prism types
export type {
  PrismPaymentConfig,
  X402PaymentAuthorization,
  Eip3009Authorization,
  PrismSettleResponse,
  PrismVerifyResponse,
} from "./modules/prism-payment/types"
export { PRISM_HANDLER_ID, PRISM_INSTRUMENT_SCHEMA } from "./modules/prism-payment/types"
