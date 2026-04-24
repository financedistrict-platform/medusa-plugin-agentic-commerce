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
import { validateWebhookUrl } from "../../lib/validate-webhook-url"
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

  private ucpEnabled = true
  private acpEnabled = true
  private settingsLastRefreshed = 0
  private static SETTINGS_CACHE_TTL = 60_000 // 60 seconds

  // Adapter names configured via plugin options — resolved from the request-
  // scoped container at runtime via resolveAdapters(scope).
  private adapterNames: string[]
  private adaptersResolved = false

  constructor(_container: Record<string, unknown>, options: AgenticCommerceOptions = {}) {
    this.signatureKey = options.signatureKey || process.env.AGENTIC_COMMERCE_SIGNATURE_KEY || ""
    this.storefrontUrl = options.storefront_url || process.env.STOREFRONT_URL || "http://localhost:8000"
    this.storeName = options.store_name || process.env.AGENTIC_STORE_NAME || "My Store"
    this.storeDescription = options.store_description || process.env.AGENTIC_STORE_DESCRIPTION || ""
    this.apiKey = options.api_key || process.env.AGENTIC_COMMERCE_API_KEY || ""
    this.paymentProviderId = options.payment_provider_id || process.env.AGENTIC_PAYMENT_PROVIDER || "pp_system_default"
    this.ucpVersion = options.ucp_version || "2026-01-11"
    this.acpVersion = options.acp_version || "2026-01-30"

    this.paymentHandlerRegistry = new PaymentHandlerRegistry()
    this.adapterNames = options.payment_handler_adapters || []

    if (this.adapterNames.length === 0) {
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

  /**
   * Resolve payment handler adapters from the request-scoped Medusa container.
   *
   * Module-scoped containers (passed to the constructor) cannot access other
   * top-level modules. The request-scoped container (req.scope) has access to
   * everything, so callers pass it in at request time.
   *
   * Idempotent: once adapters are successfully resolved, subsequent calls are
   * no-ops. If the first attempt fails (zero adapters), retries on next call.
   */
  resolveAdapters(scope: { resolve: (name: string) => unknown }): void {
    if (this.adaptersResolved && this.paymentHandlerRegistry.getAdapterCount() > 0) return
    if (this.adapterNames.length === 0) return
    this.adaptersResolved = true

    for (const name of this.adapterNames) {
      try {
        const adapter = scope.resolve(name) as PaymentHandlerAdapter | undefined
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

    if (this.adapterNames.length > 0 && this.paymentHandlerRegistry.getAdapterCount() === 0) {
      console.warn("[agentic-commerce] Configured payment handler adapters could not be resolved. Payment discovery will be empty.")
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
    if (!this.apiKey || !key) return false
    try {
      return crypto.timingSafeEqual(
        Buffer.from(key),
        Buffer.from(this.apiKey)
      )
    } catch {
      // Length mismatch — keys don't match
      return false
    }
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

  formatUcpCheckoutSession(cart: any, baseUrl: string, shippingOptions?: any[]) {
    return ucpFormatter.formatUcpCheckoutSession(this.ctx, cart, baseUrl, shippingOptions)
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
  getPaymentHandlerService(): PaymentHandlerRegistry {
    return this.paymentHandlerRegistry
  }

  // =====================================================
  // Runtime Settings (from store metadata)
  // =====================================================

  isUcpEnabled(): boolean { return this.ucpEnabled }
  isAcpEnabled(): boolean { return this.acpEnabled }

  /**
   * Reload settings from store.metadata.agentic_commerce.
   * Cached for 60 seconds to avoid hitting the DB on every request.
   */
  async refreshSettings(query: any): Promise<void> {
    const now = Date.now()
    if (now - this.settingsLastRefreshed < AgenticCommerceService.SETTINGS_CACHE_TTL) return

    try {
      const { data: [store] } = await query.graph({
        entity: "store",
        fields: ["metadata"],
      })
      const settings = store?.metadata?.agentic_commerce
      if (settings) {
        if (settings.store_name) this.storeName = settings.store_name
        if (settings.store_description !== undefined) this.storeDescription = settings.store_description
        if (settings.storefront_url) this.storefrontUrl = settings.storefront_url
        if (settings.api_key) this.apiKey = settings.api_key
        if (settings.signature_key) this.signatureKey = settings.signature_key
        if (settings.ucp_enabled !== undefined) this.ucpEnabled = settings.ucp_enabled
        if (settings.acp_enabled !== undefined) this.acpEnabled = settings.acp_enabled

        // Update formatter context
        this.ctx.storeName = this.storeName
        this.ctx.storefrontUrl = this.storefrontUrl
      }
      this.settingsLastRefreshed = now
    } catch (error: any) {
      console.warn("[agentic-commerce] Failed to refresh settings from store metadata:", error.message)
    }
  }

  // =====================================================
  // Webhooks
  // =====================================================

  async sendWebhookEvent(params: {
    url: string
    event_type: string
    payload: Record<string, unknown>
    maxRetries?: number
  }): Promise<{ status: number; success: boolean }> {
    // SSRF protection — validate URL before fetching
    const urlCheck = await validateWebhookUrl(params.url)
    if (!urlCheck.valid) {
      console.warn(`[agentic-commerce] Blocked webhook to unsafe URL: ${urlCheck.reason}`)
      return { status: 0, success: false }
    }

    const body = JSON.stringify({
      type: params.event_type,
      data: params.payload,
    })

    const signature = this.signPayload(body)
    const timestamp = new Date().toISOString()
    const maxRetries = params.maxRetries ?? 3
    const delays = [0, 2000, 10000]

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, delays[attempt] || 10000))
      }
      try {
        const response = await fetch(params.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Merchant-Signature": signature,
            "Timestamp": timestamp,
          },
          body,
          signal: AbortSignal.timeout(10_000), // 10s timeout per attempt
        })
        if (response.ok) {
          return { status: response.status, success: true }
        }
        // Client error — don't retry
        if (response.status >= 400 && response.status < 500) {
          return { status: response.status, success: false }
        }
      } catch {
        // Network error or timeout — retry
      }
    }
    return { status: 0, success: false }
  }

  // =====================================================
  // Product feed (scheduled job)
  // =====================================================

  async sendProductFeed(feedXml: string, regionId: string): Promise<void> {
    console.log(`[agentic-commerce] Product feed generated for region ${regionId} (${feedXml.length} bytes)`)
  }
}
