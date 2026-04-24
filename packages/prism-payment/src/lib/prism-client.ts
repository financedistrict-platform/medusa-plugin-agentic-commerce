/**
 * Prism Gateway API Client
 *
 * Handles the merchant-side Prism integration:
 * - checkout-prepare: Get x402 payment requirements for a checkout session
 * - payment-profile: Fetch the handler definition (for dynamic discovery)
 *
 * Settlement is handled by the Prism payment provider module directly.
 *
 * Configuration via plugin options:
 *   api_url  — Prism Gateway base URL (default: https://prism-gw.fd.xyz)
 *   api_key  — Merchant API key from Prism Console
 */

// =====================================================
// Types
// =====================================================

export type CheckoutPrepareInput = {
  /** Amount in standard units as string (e.g., "15.00" for $15). Prism expects full amount, not cents. */
  amount: string
  /** ISO 4217 currency code (e.g., "USD", "EUR") */
  currency: string
  /** Unique URL for this checkout session (used as x402 resource binding) */
  resourceUrl: string
  /** Human-readable description of what's being purchased */
  resourceDescription: string
}

export type CheckoutPrepareResult = {
  /** Handler instance config with resolved x402 requirements */
  id: string
  version: string
  config: {
    x402Version: number
    resource: {
      url: string
      description: string
    }
    accepts: X402AcceptEntry[]
  }
}

export type X402AcceptEntry = {
  /** Payment scheme (e.g., "exact" for EIP-3009) */
  scheme: string
  /** Chain identifier in CAIP-2 format (e.g., "eip155:8453" for Base) */
  network: string
  /** Amount in token base units as string (e.g., "120000000" for 120 USDC) */
  amount: string
  /** Token contract address */
  asset: string
  /** Merchant settlement address */
  payTo: string
  /** Maximum time for authorization validity */
  maxTimeoutSeconds: number
  /** Additional metadata (token name, version, etc.) */
  extra?: Record<string, unknown>
}

export type PaymentProfileResult = {
  /** The handler declaration to merge into .well-known/ucp */
  [namespace: string]: unknown[]
}

// =====================================================
// Client
// =====================================================

export type PrismClientOptions = {
  apiUrl?: string
  apiKey?: string
}

export class PrismClient {
  private apiUrl: string
  private apiKey: string

  constructor(options: PrismClientOptions = {}) {
    this.apiUrl = options.apiUrl || process.env.PRISM_API_URL || "https://prism-gw.fd.xyz"
    this.apiKey = options.apiKey || process.env.PRISM_API_KEY || ""
  }

  /**
   * Prepare checkout via Prism.
   *
   * Called when a checkout session is created or updated (total changes).
   * Returns the x402 payment requirements that the agent wallet needs
   * to construct a valid EIP-3009 authorization.
   */
  async checkoutPrepare(input: CheckoutPrepareInput): Promise<CheckoutPrepareResult> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty payment config")
      return this.emptyConfig(input)
    }

    const response = await fetch(`${this.apiUrl}/api/v2/merchant/checkout-prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        resource: {
          url: input.resourceUrl,
          description: input.resourceDescription,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      console.error(`[prism-client] checkout-prepare failed (${response.status}): ${errorText}`)
      throw new Error(`Prism checkout-prepare failed: ${response.status}`)
    }

    const data = await response.json() as Record<string, unknown>

    // Prism returns a namespace-wrapped response: { "xyz.fd.prism_payment": [{ id, version, config }] }
    const PRISM_NAMESPACE = "xyz.fd.prism_payment"
    const handlers = (data[PRISM_NAMESPACE] ?? Object.values(data)[0]) as CheckoutPrepareResult[] | undefined
    if (!handlers || !Array.isArray(handlers) || handlers.length === 0) {
      console.warn(`[prism-client] checkout-prepare returned no handlers`)
      return this.emptyConfig(input)
    }

    return handlers[0]
  }

  /**
   * Fetch handler definition from Prism.
   *
   * Called to get the current handler declaration for .well-known/ucp.
   * Can be cached (handler definitions don't change per checkout).
   */
  async fetchPaymentProfile(): Promise<PaymentProfileResult> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty profile")
      return {}
    }

    const response = await fetch(`${this.apiUrl}/api/v2/merchant/payment-profile`, {
      method: "GET",
      headers: {
        "X-API-Key": this.apiKey,
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      console.error(`[prism-client] payment-profile failed (${response.status}): ${errorText}`)
      throw new Error(`Prism payment-profile failed: ${response.status}`)
    }

    return response.json() as Promise<PaymentProfileResult>
  }

  /**
   * Fallback config when Prism API key is not configured.
   */
  private emptyConfig(input: CheckoutPrepareInput): CheckoutPrepareResult {
    return {
      id: "prism_default",
      version: "2026-01-23",
      config: {
        x402Version: 2,
        resource: {
          url: input.resourceUrl,
          description: input.resourceDescription,
        },
        accepts: [],
      },
    }
  }
}
