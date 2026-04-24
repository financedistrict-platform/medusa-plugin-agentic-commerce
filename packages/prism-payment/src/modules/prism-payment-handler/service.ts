/**
 * Prism Payment Handler Adapter
 *
 * Implements the PaymentHandlerAdapter interface from
 * @financedistrict/medusa-plugin-agentic-commerce.
 *
 * Provides x402 stablecoin payment support via the Prism Gateway:
 * - Discovery: advertises Prism payment handlers in .well-known/ucp and .well-known/acp.json
 * - Checkout preparation: calls Prism checkout-prepare to get x402 payment requirements
 * - Response formatting: includes Prism payment config in checkout session responses
 *
 * Register this module in medusa-config.ts, then reference "prismPaymentHandler"
 * in the agentic commerce plugin's payment_handler_adapters option.
 */

import type { PaymentHandlerAdapter, CheckoutPrepareInput } from "@financedistrict/medusa-plugin-agentic-commerce"
import { PrismClient } from "../../lib/prism-client"
import type { CheckoutPrepareResult } from "../../lib/prism-client"
import { PRISM_HANDLER_ID } from "../prism-payment/types"

// =====================================================
// Constants
// =====================================================

/** Metadata key where checkout-prepare config is stored on the cart */
export const PRISM_CHECKOUT_CONFIG_KEY = "prism_checkout_config"

// =====================================================
// Options
// =====================================================

export type PrismPaymentHandlerOptions = {
  /** Prism Gateway API base URL (default: https://prism-gw.fd.xyz) */
  api_url?: string
  /** Prism Gateway API key for merchant authentication */
  api_key?: string
}

// =====================================================
// Service
// =====================================================

export default class PrismPaymentHandlerAdapter implements PaymentHandlerAdapter {
  readonly id = PRISM_HANDLER_ID
  readonly name = "Finance District Prism"

  private client: PrismClient

  /** Cached Prism payment-profile for discovery (5 min TTL) */
  private profileCache: { data: Record<string, unknown[]>; expiry: number } | null = null
  private readonly PROFILE_TTL = 5 * 60 * 1000

  constructor(_container: Record<string, unknown>, options: PrismPaymentHandlerOptions = {}) {
    this.client = new PrismClient({
      apiUrl: options.api_url,
      apiKey: options.api_key,
    })
  }

  // -------------------------------------------------
  // Discovery — for .well-known/ucp and .well-known/acp.json
  // -------------------------------------------------

  async getUcpDiscoveryHandlers(): Promise<Record<string, unknown[]>> {
    return this.fetchProfile()
  }

  async getAcpDiscoveryHandlers(): Promise<unknown[]> {
    const profile = await this.fetchProfile()
    const handlers: unknown[] = []

    for (const [namespace, entries] of Object.entries(profile)) {
      for (const entry of entries as any[]) {
        handlers.push({
          id: namespace,
          name: entry.name || "Prism Payment",
          version: entry.version || "2026-01-15",
          psp: "prism",
          requires_delegate_payment: false,
          instrument_schemas: [{
            type: "x402_authorization",
            description: "x402 payment authorization signed by the agent wallet",
            credential_schema: {
              type: "object",
              required: ["authorization"],
              properties: {
                authorization: { type: "string" },
                x402_version: { type: "integer", enum: [1, 2], default: 2 },
              },
            },
          }],
          ...(entry.config ? { config: entry.config } : {}),
        })
      }
    }

    return handlers
  }

  // -------------------------------------------------
  // Checkout preparation — call Prism, store on cart
  // -------------------------------------------------

  async prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<CheckoutPrepareResult | null> {
    const { cart, checkoutBaseUrl, storeName, container } = input

    const totalMinor = cart.total ?? cart.raw_total?.value ?? 0
    const currency = (cart.currency_code || "eur").toUpperCase()
    const amount = (totalMinor / 100).toString()
    const resourceUrl = `${checkoutBaseUrl}/${cart.id}`

    // Idempotency — skip if already prepared for this exact total
    const existingConfig = cart.metadata?.[PRISM_CHECKOUT_CONFIG_KEY] as any
    if (existingConfig?.config?.resource?.url === resourceUrl) {
      const existingAmount = existingConfig._prepared_amount
      if (existingAmount === amount) {
        return existingConfig as CheckoutPrepareResult
      }
    }

    // Call Prism checkout-prepare
    let prepareResult: CheckoutPrepareResult
    try {
      prepareResult = await this.client.checkoutPrepare({
        amount,
        currency,
        resourceUrl,
        resourceDescription: `Purchase from ${storeName}`,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      console.error(`[prism-payment-handler] checkout-prepare failed for cart ${cart.id}: ${message}`)
      return null
    }

    // Store on cart metadata for subsequent GET requests
    try {
      const cartModuleService = container.resolve("cart") as any
      await cartModuleService.updateCarts(cart.id, {
        metadata: {
          ...(cart.metadata || {}),
          [PRISM_CHECKOUT_CONFIG_KEY]: {
            ...prepareResult,
            _prepared_amount: amount,
          },
        },
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      console.error(`[prism-payment-handler] Failed to store config on cart ${cart.id}: ${message}`)
    }

    return prepareResult
  }

  // -------------------------------------------------
  // Response formatting
  // -------------------------------------------------

  getUcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): Record<string, unknown[]> {
    const config = cartMetadata?.[PRISM_CHECKOUT_CONFIG_KEY] as any
    if (!config?.config) return {}

    return {
      [PRISM_HANDLER_ID]: [{
        id: config.id || "x402",
        version: config.version || "2026-01-15",
        config: config.config,
      }],
    }
  }

  getAcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): unknown[] {
    const config = cartMetadata?.[PRISM_CHECKOUT_CONFIG_KEY] as any
    if (!config?.config) return []

    return [{
      id: PRISM_HANDLER_ID,
      name: "Finance District Prism",
      version: config.version || "2026-01-15",
      psp: "prism",
      requires_delegate_payment: false,
      instrument_schemas: [{
        type: "x402_authorization",
        description: "x402 payment authorization signed by the agent wallet",
        credential_schema: {
          type: "object",
          required: ["authorization"],
          properties: {
            authorization: { type: "string" },
            x402_version: { type: "integer", enum: [1, 2], default: 2 },
          },
        },
      }],
      config: config.config,
    }]
  }

  // -------------------------------------------------
  // Internal
  // -------------------------------------------------

  private async fetchProfile(): Promise<Record<string, unknown[]>> {
    const now = Date.now()
    if (this.profileCache && now < this.profileCache.expiry) {
      return this.profileCache.data
    }

    try {
      const data = await this.client.fetchPaymentProfile()
      this.profileCache = { data, expiry: now + this.PROFILE_TTL }
      return data
    } catch {
      return this.profileCache?.data || {}
    }
  }
}
