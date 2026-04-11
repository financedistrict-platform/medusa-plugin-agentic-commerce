/**
 * Agentic Commerce Service
 *
 * Configuration holder and facade for the agentic commerce plugin.
 * Resolved from the Medusa container as "agenticCommerce".
 *
 * Responsibilities:
 * - Store configuration (name, URL, versions)
 * - Auth: API key validation, HMAC signing/verification
 * - Formatting: delegates to protocol-specific formatters (src/lib/formatters/)
 * - Payment: delegates to PaymentHandlerRegistry with pluggable adapters
 * - Webhooks: event dispatch to registered URLs
 */

import crypto from "crypto"
import { PaymentHandlerRegistry } from "../../lib/payment-handler-registry"
import type { PaymentHandlerAdapter } from "../../types/payment-handler-adapter"
import type { FormatterContext } from "../../lib/formatters/types"
import * as ucpFormatter from "../../lib/formatters/ucp"
import * as acpFormatter from "../../lib/formatters/acp"

export type AgenticCommerceOptions = {
  signatureKey?: string
  storefront_url?: string
  store_name?: string
  store_description?: string
  api_key?: string
  payment_provider_id?: string
  ucp_version?: string
  acp_version?: string
  /**
   * Container service names of PaymentHandlerAdapter implementations.
   * Each name must match a Medusa module registered by a payment handler plugin.
   *
   * Example: ["prismPaymentHandler"]
   *
   * The referenced modules must implement the PaymentHandlerAdapter interface from
   * @financedistrict/medusa-plugin-agentic-commerce.
   */
  payment_handler_adapters?: string[]
}

export default class AgenticCommerceService {
  private signatureKey: string
  private storefrontUrl: string
  private storeName: string
  private storeDescription: string
  private apiKey: string
  private paymentProviderId: string
  private ucpVersion: string
  private acpVersion: string
  private paymentHandlerRegistry: PaymentHandlerRegistry
  private ctx: FormatterContext

  constructor(container: Record<string, unknown>, options: AgenticCommerceOptions = {}) {
    this.signatureKey = options.signatureKey || process.env.AGENTIC_COMMERCE_SIGNATURE_KEY || ""
    this.storefrontUrl = options.storefront_url || process.env.STOREFRONT_URL || "http://localhost:8000"
    this.storeName = options.store_name || process.env.AGENTIC_STORE_NAME || "My Store"
    this.storeDescription = options.store_description || process.env.AGENTIC_STORE_DESCRIPTION || ""
    this.apiKey = options.api_key || process.env.AGENTIC_COMMERCE_API_KEY || ""
    this.paymentProviderId = options.payment_provider_id || process.env.AGENTIC_PAYMENT_PROVIDER || "pp_system_default"
    this.ucpVersion = options.ucp_version || "2026-01-11"
    this.acpVersion = options.acp_version || "2026-01-30"

    // Create payment handler registry and resolve adapters from the container
    this.paymentHandlerRegistry = new PaymentHandlerRegistry()

    const adapterNames = options.payment_handler_adapters || []
    for (const name of adapterNames) {
      try {
        const adapter = (container as any)[name] as PaymentHandlerAdapter | undefined
        if (adapter && typeof adapter.getUcpDiscoveryHandlers === "function") {
          this.paymentHandlerRegistry.registerAdapter(adapter)
        } else {
          console.warn(`[agentic-commerce] Service "${name}" does not implement PaymentHandlerAdapter interface`)
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[agentic-commerce] Could not resolve payment handler adapter "${name}": ${message}`)
      }
    }

    if (adapterNames.length === 0) {
      console.info("[agentic-commerce] No payment handler adapters configured. Payment handler discovery will return empty results.")
    }

    // Shared context passed to all formatters
    this.ctx = {
      storeName: this.storeName,
      storefrontUrl: this.storefrontUrl,
      ucpVersion: this.ucpVersion,
      acpVersion: this.acpVersion,
      paymentHandlers: this.paymentHandlerRegistry,
    }
  }

  // =====================================================
  // Auth
  // =====================================================

  signPayload(payload: string): string {
    return crypto
      .createHmac("sha256", this.signatureKey)
      .update(payload)
      .digest("hex")
  }

  verifySignature(payload: string, signature: string): boolean {
    const expected = this.signPayload(payload)
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(signature, "hex")
      )
    } catch {
      return false
    }
  }

  validateApiKey(key: string): boolean {
    return key === this.apiKey
  }

  // =====================================================
  // Formatters — delegate to protocol-specific modules
  // =====================================================

  formatAcpCheckoutSession(cart: any, baseUrl: string) {
    return acpFormatter.formatAcpCheckoutSession(this.ctx, cart, baseUrl)
  }

  formatAcpCompleteResponse(cart: any, baseUrl: string, orderId: string | null, cartId: string) {
    return acpFormatter.formatAcpCompleteResponse(this.ctx, cart, baseUrl, orderId, cartId)
  }

  formatAcpOrder(order: any, baseUrl: string) {
    return acpFormatter.formatAcpOrder(this.ctx, order, baseUrl)
  }

  formatUcpCheckoutSession(cart: any, baseUrl: string) {
    return ucpFormatter.formatUcpCheckoutSession(this.ctx, cart, baseUrl)
  }

  formatUcpCart(cart: any, baseUrl: string) {
    return ucpFormatter.formatUcpCart(this.ctx, cart, baseUrl)
  }

  formatUcpProduct(product: any) {
    return ucpFormatter.formatUcpProduct(product)
  }

  formatUcpOrder(order: any, baseUrl: string) {
    return ucpFormatter.formatUcpOrder(this.ctx, order, baseUrl)
  }

  // =====================================================
  // Getters
  // =====================================================

  getStorefrontUrl(): string { return this.storefrontUrl }
  getStoreName(): string { return this.storeName }
  getStoreDescription(): string { return this.storeDescription }
  getPaymentProviderId(): string { return this.paymentProviderId }
  getUcpVersion(): string { return this.ucpVersion }
  getAcpVersion(): string { return this.acpVersion }
  getPaymentHandlerService(): PaymentHandlerRegistry { return this.paymentHandlerRegistry }

  // =====================================================
  // Webhooks
  // =====================================================

  async sendWebhookEvent(params: {
    url: string
    event_type: string
    payload: Record<string, unknown>
  }): Promise<void> {
    const body = JSON.stringify({
      type: params.event_type,
      data: params.payload,
    })

    const signature = this.signPayload(body)
    const timestamp = new Date().toISOString()

    try {
      await fetch(params.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Merchant-Signature": signature,
          "Timestamp": timestamp,
        },
        body,
      })
    } catch {
      // Best effort — don't throw on webhook failure
    }
  }

  // =====================================================
  // Product feed (scheduled job)
  // =====================================================

  async sendProductFeed(feedXml: string, regionId: string): Promise<void> {
    console.log(`[agentic-commerce] Product feed generated for region ${regionId} (${feedXml.length} bytes)`)
  }
}
