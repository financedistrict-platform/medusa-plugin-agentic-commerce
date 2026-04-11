/**
 * Payment Handler Adapter Interface
 *
 * Implement this interface to add a new payment handler to the agentic commerce plugin.
 * Each adapter provides discovery, checkout preparation, and response formatting
 * for a specific payment provider (e.g., Prism x402, Stripe, Coinbase, etc.)
 *
 * Example implementation:
 * ```ts
 * import type { PaymentHandlerAdapter } from "@financedistrict/medusa-plugin-agentic-commerce"
 *
 * class StripePaymentHandlerAdapter implements PaymentHandlerAdapter {
 *   readonly id = "com.stripe.payment"
 *   readonly name = "Stripe"
 *   // ... implement all methods
 * }
 * ```
 *
 * Register your adapter as a Medusa module, then reference it by container name
 * in the agentic commerce plugin options:
 * ```ts
 * // medusa-config.ts
 * modules: [
 *   { resolve: "your-adapter-plugin/modules/your-adapter", options: { ... } },
 *   {
 *     resolve: "@financedistrict/medusa-plugin-agentic-commerce/modules/agentic-commerce",
 *     options: { payment_handler_adapters: ["yourAdapterServiceName"] },
 *   },
 * ]
 * ```
 */

// =====================================================
// Adapter Interface
// =====================================================

export interface PaymentHandlerAdapter {
  /** Unique identifier for this adapter (e.g., "xyz.fd.prism_payment") */
  readonly id: string

  /** Human-readable name (e.g., "Finance District Prism") */
  readonly name: string

  /**
   * Return UCP discovery handler entries for .well-known/ucp.
   * Keyed by handler namespace (e.g., "xyz.fd.prism_payment").
   * Return empty object if nothing to advertise.
   */
  getUcpDiscoveryHandlers(): Promise<Record<string, unknown[]>>

  /**
   * Return ACP discovery handler entries for .well-known/acp.json.
   * Flat array of handler objects for capabilities.payment.handlers.
   * Return empty array if nothing to advertise.
   */
  getAcpDiscoveryHandlers(): Promise<unknown[]>

  /**
   * Prepare payment requirements for a checkout session.
   *
   * Called when a checkout session is created or updated (total changes).
   * The adapter should:
   * 1. Call its payment gateway to get payment requirements
   * 2. Store the result on cart metadata under a key it owns
   * 3. Return the result (or null on failure)
   *
   * The adapter is responsible for idempotency — skip the API call
   * if already prepared for the same cart total.
   */
  prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<unknown | null>

  /**
   * Return UCP payment_handlers block for a checkout session response.
   * Reads its own stored data from cart metadata.
   * Return empty object if no data available.
   */
  getUcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): Record<string, unknown[]>

  /**
   * Return ACP payment handlers array for a checkout session response.
   * Reads its own stored data from cart metadata.
   * Return empty array if no data available.
   */
  getAcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): unknown[]
}

// =====================================================
// Input Types
// =====================================================

export type CheckoutPrepareInput = {
  cart: {
    id: string
    total?: number
    raw_total?: { value: number }
    currency_code?: string
    metadata?: Record<string, unknown>
  }
  /** Base URL for checkout session resources (e.g., "https://store.example.com/ucp/checkout-sessions") */
  checkoutBaseUrl: string
  /** Human-readable store name for payment descriptions */
  storeName: string
  /** Medusa DI container for resolving services (e.g., cart module for metadata updates) */
  container: any
}
