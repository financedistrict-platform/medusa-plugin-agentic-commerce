/**
 * Payment Handler Registry
 *
 * Manages registered payment handler adapters and delegates calls to all of them.
 * This replaces the previous PaymentHandlerService which hardcoded Prism logic.
 *
 * When multiple adapters are registered:
 * - Discovery: merges all handler definitions (UCP: merge objects, ACP: concatenate arrays)
 * - Checkout prepare: calls all adapters in parallel
 * - Response formatting: merges all handler blocks
 *
 * When zero adapters are registered (degraded mode):
 * - All methods return empty results
 * - The store still works, just without payment handler info in responses
 */

import type { PaymentHandlerAdapter, CheckoutPrepareInput } from "../types/payment-handler-adapter"

export class PaymentHandlerRegistry {
  private adapters: PaymentHandlerAdapter[] = []

  /**
   * Register a payment handler adapter.
   * Called by AgenticCommerceService during initialization.
   */
  registerAdapter(adapter: PaymentHandlerAdapter): void {
    // Prevent duplicate registration
    if (this.adapters.some((a) => a.id === adapter.id)) {
      console.warn(`[payment-handler-registry] Adapter "${adapter.id}" already registered, skipping duplicate`)
      return
    }

    this.adapters.push(adapter)
    console.log(`[payment-handler-registry] Registered adapter: ${adapter.name} (${adapter.id})`)
  }

  /**
   * Get all registered adapters.
   */
  getAdapters(): readonly PaymentHandlerAdapter[] {
    return this.adapters
  }

  /**
   * Get the number of registered adapters.
   */
  getAdapterCount(): number {
    return this.adapters.length
  }

  // -------------------------------------------------
  // Discovery — for .well-known/ucp and .well-known/acp.json
  // -------------------------------------------------

  /**
   * Get combined UCP payment handler definitions from all adapters.
   * Returns merged namespace-keyed object.
   */
  async getUcpDiscoveryHandlers(): Promise<Record<string, unknown[]>> {
    if (this.adapters.length === 0) return {}

    const results = await Promise.allSettled(
      this.adapters.map((a) => a.getUcpDiscoveryHandlers())
    )

    const merged: Record<string, unknown[]> = {}
    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const [namespace, entries] of Object.entries(result.value)) {
          if (!merged[namespace]) {
            merged[namespace] = []
          }
          merged[namespace].push(...entries)
        }
      }
    }

    return merged
  }

  /**
   * Get combined ACP payment handler definitions from all adapters.
   * Returns concatenated flat array.
   */
  async getAcpDiscoveryHandlers(): Promise<unknown[]> {
    if (this.adapters.length === 0) return []

    const results = await Promise.allSettled(
      this.adapters.map((a) => a.getAcpDiscoveryHandlers())
    )

    const merged: unknown[] = []
    for (const result of results) {
      if (result.status === "fulfilled") {
        merged.push(...result.value)
      }
    }

    return merged
  }

  // -------------------------------------------------
  // Checkout preparation — delegates to all adapters
  // -------------------------------------------------

  /**
   * Prepare checkout payment requirements via all registered adapters.
   * Calls each adapter in parallel. Returns results keyed by adapter ID.
   *
   * Each adapter stores its own data on cart metadata under its own key.
   */
  async prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<Record<string, unknown | null>> {
    if (this.adapters.length === 0) return {}

    const results = await Promise.allSettled(
      this.adapters.map(async (a) => ({
        id: a.id,
        result: await a.prepareCheckoutPayment(input),
      }))
    )

    const output: Record<string, unknown | null> = {}
    for (const result of results) {
      if (result.status === "fulfilled") {
        output[result.value.id] = result.value.result
      } else {
        console.error(`[payment-handler-registry] Adapter failed during checkout-prepare:`, result.reason)
      }
    }

    return output
  }

  // -------------------------------------------------
  // Response formatting — merge from all adapters
  // -------------------------------------------------

  /**
   * Get combined UCP payment_handlers for a checkout session response.
   */
  getUcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): Record<string, unknown[]> {
    if (this.adapters.length === 0) return {}

    const merged: Record<string, unknown[]> = {}
    for (const adapter of this.adapters) {
      const handlers = adapter.getUcpCheckoutHandlers(cartMetadata)
      for (const [namespace, entries] of Object.entries(handlers)) {
        if (!merged[namespace]) {
          merged[namespace] = []
        }
        merged[namespace].push(...entries)
      }
    }

    return merged
  }

  /**
   * Get combined ACP payment handlers for a checkout session response.
   */
  getAcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): unknown[] {
    if (this.adapters.length === 0) return []

    const merged: unknown[] = []
    for (const adapter of this.adapters) {
      merged.push(...adapter.getAcpCheckoutHandlers(cartMetadata))
    }

    return merged
  }
}
