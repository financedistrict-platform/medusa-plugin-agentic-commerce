/**
 * Prism Payment Handler Adapter
 *
 * Implements the PaymentHandlerAdapter interface from
 * @financedistrict/medusa-plugin-agentic-commerce.
 *
 * Wires Prism's protocol-specific Merchant API endpoints (UCP and ACP
 * variants of `/handlers` and `/payment-requirements`) into the
 * agentic commerce plugin. Discovery and checkout-prepare responses
 * are passed through verbatim — Prism is the authority on its own
 * handler shape.
 *
 * Register this module in medusa-config.ts, then reference
 * "prismPaymentHandler" in the agentic commerce plugin's
 * payment_handler_adapters option.
 */

import type { PaymentHandlerAdapter, CheckoutPrepareInput } from "@financedistrict/medusa-plugin-agentic-commerce"
import {
  PrismClient,
  type AcpHandler,
  type PaymentHandlerConfig,
  type UcpCheckoutPrepareResponse,
  type UcpHandlersDiscoveryResponse,
} from "../../lib/prism-client"
import { PRISM_HANDLER_ID } from "../prism-payment/types"

// =====================================================
// Constants
// =====================================================

/**
 * Metadata key where the prepared UCP+ACP payload is stored on the
 * cart. Replaces the legacy `prism_checkout_config` blob.
 */
export const PRISM_CHECKOUT_DATA_KEY = "prism_checkout_data"

/** Legacy key — still read on prepare for one-cycle migration. */
export const PRISM_CHECKOUT_CONFIG_KEY = "prism_checkout_config"

// =====================================================
// Stored shape (per-cart metadata blob)
// =====================================================

type PrismCheckoutData = {
  ucp: UcpCheckoutPrepareResponse | null
  acp: AcpHandler | null
  /** Used for idempotency — set once per (resource, amount) pair */
  preparedAmount: string
  preparedResourceUrl: string
}

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

  /** Cached UCP discovery response (5 min TTL) */
  private ucpDiscoveryCache: { data: UcpHandlersDiscoveryResponse; expiry: number } | null = null
  /** Cached ACP discovery response (5 min TTL) */
  private acpDiscoveryCache: { data: AcpHandler[]; expiry: number } | null = null
  private readonly DISCOVERY_TTL = 5 * 60 * 1000

  constructor(_container: Record<string, unknown>, options: PrismPaymentHandlerOptions = {}) {
    this.client = new PrismClient({
      apiUrl: options.api_url,
      apiKey: options.api_key,
    })
  }

  // -------------------------------------------------
  // Discovery — for .well-known/ucp and .well-known/acp.json
  // -------------------------------------------------

  async getUcpDiscoveryHandlers(): Promise<UcpHandlersDiscoveryResponse> {
    return this.fetchUcpDiscovery()
  }

  async getAcpDiscoveryHandlers(): Promise<AcpHandler[]> {
    return this.fetchAcpDiscovery()
  }

  // -------------------------------------------------
  // Checkout preparation — call Prism, store on cart
  // -------------------------------------------------

  async prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<PrismCheckoutData | null> {
    const { cart, checkoutBaseUrl, storeName, container } = input

    const totalMinor = cart.total ?? cart.raw_total?.value ?? 0
    const currency = (cart.currency_code || "eur").toUpperCase()
    const amount = (totalMinor / 100).toString()
    const resourceUrl = `${checkoutBaseUrl}/${cart.id}`

    // Idempotency — return existing blob if we already prepared for
    // this exact (resource, amount) pair.
    const existing = cart.metadata?.[PRISM_CHECKOUT_DATA_KEY] as PrismCheckoutData | undefined
    if (
      existing &&
      existing.preparedResourceUrl === resourceUrl &&
      existing.preparedAmount === amount &&
      (existing.ucp || existing.acp)
    ) {
      return existing
    }

    const prepareInput = {
      amount,
      currency,
      resourceUrl,
      resourceDescription: `Purchase from ${storeName}`,
    }

    // Call UCP and ACP prepare in parallel — fail-soft per protocol so
    // a transient error on one side doesn't kill the other.
    const [ucpResult, acpResult] = await Promise.allSettled([
      this.client.prepareUcpPayment(prepareInput),
      this.client.prepareAcpPayment(prepareInput),
    ])

    const ucp = ucpResult.status === "fulfilled" ? ucpResult.value : null
    const acp = acpResult.status === "fulfilled" ? acpResult.value : null

    if (ucpResult.status === "rejected") {
      console.error(
        `[prism-payment-handler] UCP prepare failed for cart ${cart.id}: ${ucpResult.reason}`,
      )
    }
    if (acpResult.status === "rejected") {
      console.error(
        `[prism-payment-handler] ACP prepare failed for cart ${cart.id}: ${acpResult.reason}`,
      )
    }

    if (!ucp && !acp) {
      return null
    }

    const data: PrismCheckoutData = {
      ucp,
      acp,
      preparedAmount: amount,
      preparedResourceUrl: resourceUrl,
    }

    // Persist on cart metadata for subsequent GET requests.
    try {
      const cartModuleService = container.resolve("cart") as any
      await cartModuleService.updateCarts(cart.id, {
        metadata: {
          ...(cart.metadata || {}),
          [PRISM_CHECKOUT_DATA_KEY]: data,
        },
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      console.error(`[prism-payment-handler] Failed to store config on cart ${cart.id}: ${message}`)
    }

    return data
  }

  // -------------------------------------------------
  // Response formatting
  // -------------------------------------------------

  getUcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): Record<string, unknown[]> {
    const data = cartMetadata?.[PRISM_CHECKOUT_DATA_KEY] as PrismCheckoutData | undefined
    return data?.ucp ?? {}
  }

  getAcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): unknown[] {
    const data = cartMetadata?.[PRISM_CHECKOUT_DATA_KEY] as PrismCheckoutData | undefined
    return data?.acp ? [data.acp] : []
  }

  // -------------------------------------------------
  // Helpers
  // -------------------------------------------------

  /**
   * Pull the x402 PaymentHandlerConfig from stored cart metadata.
   * Prefers UCP storage; falls back to ACP. Both wrap the same x402
   * payload so any settlement consumer can use either.
   */
  extractPaymentConfig(cartMetadata?: Record<string, unknown>): PaymentHandlerConfig | null {
    const data = cartMetadata?.[PRISM_CHECKOUT_DATA_KEY] as PrismCheckoutData | undefined
    if (!data) return null

    if (data.ucp) {
      const firstNamespace = Object.values(data.ucp)[0]
      const firstEntry = firstNamespace?.[0]
      if (firstEntry?.config) return firstEntry.config
    }

    if (data.acp?.config && this.isPaymentHandlerConfig(data.acp.config)) {
      return data.acp.config
    }

    return null
  }

  private isPaymentHandlerConfig(value: unknown): value is PaymentHandlerConfig {
    return (
      typeof value === "object" &&
      value !== null &&
      "x402Version" in value &&
      "accepts" in value
    )
  }

  // -------------------------------------------------
  // Internal — discovery caching
  // -------------------------------------------------

  private async fetchUcpDiscovery(): Promise<UcpHandlersDiscoveryResponse> {
    const now = Date.now()
    if (this.ucpDiscoveryCache && now < this.ucpDiscoveryCache.expiry) {
      return this.ucpDiscoveryCache.data
    }
    try {
      const data = await this.client.fetchUcpHandlers()
      this.ucpDiscoveryCache = { data, expiry: now + this.DISCOVERY_TTL }
      return data
    } catch (error: unknown) {
      console.error(`[prism-payment-handler] UCP discovery failed: ${error}`)
      return this.ucpDiscoveryCache?.data ?? {}
    }
  }

  private async fetchAcpDiscovery(): Promise<AcpHandler[]> {
    const now = Date.now()
    if (this.acpDiscoveryCache && now < this.acpDiscoveryCache.expiry) {
      return this.acpDiscoveryCache.data
    }
    try {
      const data = await this.client.fetchAcpHandlers()
      this.acpDiscoveryCache = { data, expiry: now + this.DISCOVERY_TTL }
      return data
    } catch (error: unknown) {
      console.error(`[prism-payment-handler] ACP discovery failed: ${error}`)
      return this.acpDiscoveryCache?.data ?? []
    }
  }
}
