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
  normalizeUcpHandlers,
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

  private ucpDiscoveryCache = new Map<string, { data: UcpHandlersDiscoveryResponse; expiry: number }>()
  private acpDiscoveryCache = new Map<string, { data: AcpHandler[]; expiry: number }>()
  private readonly DISCOVERY_TTL = 5 * 60 * 1000
  private readonly DISCOVERY_FAILURE_TTL = 60 * 1000

  constructor(_container: Record<string, unknown>, options: PrismPaymentHandlerOptions = {}) {
    this.client = new PrismClient({
      apiUrl: options.api_url,
      apiKey: options.api_key,
    })
  }

  // -------------------------------------------------
  // Discovery — for .well-known/ucp and .well-known/acp.json
  // -------------------------------------------------

  async getUcpDiscoveryHandlers(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    return this.fetchUcpDiscovery(ucpVersion)
  }

  async getAcpDiscoveryHandlers(ucpVersion: string): Promise<AcpHandler[]> {
    return this.fetchAcpDiscovery(ucpVersion)
  }

  // -------------------------------------------------
  // Checkout preparation — call Prism, store on cart
  // -------------------------------------------------

  async prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<PrismCheckoutData | null> {
    const { cart, checkoutBaseUrl, storeName, ucpVersion, container } = input

    // Medusa v2 stores cart.total in MAJOR units as a BigNumber (e.g., 17 for
    // €17.00, not 1700). Prism's `amount` field expects a decimal string in
    // standard/major units ("15.00" for $15) — see prism-client.ts.
    //
    // Subtle: Medusa's BigNumber implements Symbol.toPrimitive — when called
    // with hint="string" (which is what String() and template literals do) it
    // returns the bignumber.js raw value at 20-digit precision, e.g. "34"
    // becomes "34.000000000000000000". Prism's /payment-requirements endpoint
    // rejects that format, the call throws, Promise.allSettled below swallows
    // the rejection, the adapter returns null, no metadata is written, and the
    // checkout session renders with `payment_handlers: {}` — agents see
    // `ready_for_complete` with no way to pay.
    //
    // Coerce to a regular number first (Number() triggers Symbol.toPrimitive
    // with hint="number" which returns BigNumber.numeric — a plain JS number)
    // before stringifying, so we send a clean decimal like "34" or "17.5".
    const totalMajor = cart.total ?? cart.raw_total?.value ?? 0
    const currency = (cart.currency_code || "eur").toUpperCase()
    const amount = String(Number(totalMajor))
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
      this.client.prepareUcpPayment(prepareInput, ucpVersion),
      this.client.prepareAcpPayment(prepareInput, ucpVersion),
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

  private async fetchUcpDiscovery(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    const now = Date.now()
    const key = `${this.client.getApiUrl()}|${ucpVersion}`
    const cached = this.ucpDiscoveryCache.get(key)
    if (cached && now < cached.expiry) {
      return cached.data
    }
    try {
      const data = normalizeUcpHandlers(await this.client.fetchUcpHandlers(ucpVersion))
      if (!data) {
        console.error(`[prism-payment-handler] UCP discovery returned an invalid ${PRISM_HANDLER_ID} entry; handler omitted`)
        return this.failUcpDiscovery(key, now)
      }
      this.ucpDiscoveryCache.set(key, { data, expiry: now + this.DISCOVERY_TTL })
      return data
    } catch (error: unknown) {
      console.error(`[prism-payment-handler] UCP discovery failed: ${error}`)
      return this.failUcpDiscovery(key, now)
    }
  }

  private failUcpDiscovery(key: string, now: number): UcpHandlersDiscoveryResponse {
    this.ucpDiscoveryCache.set(key, { data: {}, expiry: now + this.DISCOVERY_FAILURE_TTL })
    return {}
  }

  private async fetchAcpDiscovery(ucpVersion: string): Promise<AcpHandler[]> {
    const now = Date.now()
    const key = `${this.client.getApiUrl()}|${ucpVersion}`
    const cached = this.acpDiscoveryCache.get(key)
    if (cached && now < cached.expiry) {
      return cached.data
    }
    try {
      const data = await this.client.fetchAcpHandlers(ucpVersion)
      this.acpDiscoveryCache.set(key, { data, expiry: now + this.DISCOVERY_TTL })
      return data
    } catch (error: unknown) {
      console.error(`[prism-payment-handler] ACP discovery failed: ${error}`)
      return cached?.data ?? []
    }
  }
}
