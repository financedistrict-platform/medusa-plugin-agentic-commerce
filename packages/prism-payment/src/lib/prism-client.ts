/**
 * Prism Gateway API Client
 *
 * Handles the merchant-side Prism integration using protocol-specific
 * endpoints (separate UCP and ACP variants — the older generic
 * `payment-profile` and `checkout-prepare` endpoints are deprecated).
 *
 * Endpoints used:
 * - GET  /api/v2/merchant/ucp/handlers              — UCP discovery
 * - GET  /api/v2/merchant/acp/handlers              — ACP discovery
 * - POST /api/v2/merchant/ucp/payment-requirements  — UCP checkout prepare
 * - POST /api/v2/merchant/acp/payment-requirements  — ACP checkout prepare
 *
 * Settlement is handled by the Prism payment provider module directly,
 * not via this client.
 *
 * Configuration via plugin options:
 *   api_url  — Prism Gateway base URL (default: https://prism-gw.fd.xyz)
 *   api_key  — Merchant API key from Prism Console
 */

// =====================================================
// Shared payment-requirements input
// =====================================================

export type PreparePaymentInput = {
  /** Amount in standard units as string (e.g., "15.00" for $15). Prism expects full amount, not cents. */
  amount: string
  /** ISO 4217 currency code (e.g., "USD", "EUR") */
  currency: string
  /** Unique URL for this checkout session (used as x402 resource binding) */
  resourceUrl: string
  /** Human-readable description of what's being purchased */
  resourceDescription: string
}

// =====================================================
// UCP shapes (per Prism OpenAPI)
// =====================================================

/** A single UCP discovery entry — `/ucp/handlers` returns these keyed by namespace */
export type UcpHandlerDiscoveryEntry = {
  id: string
  version: string
  spec: string
  schema: string
  config: unknown
}

/** UCP discovery response: `{ "xyz.fd.prism_payment": [...] }` */
export type UcpHandlersDiscoveryResponse = Record<string, UcpHandlerDiscoveryEntry[]>

/** A single UCP checkout-prepare entry — same namespace keying, smaller shape */
export type UcpCheckoutHandlerEntry = {
  id: string
  version: string
  config: PaymentHandlerConfig
}

/** UCP checkout-prepare response: `{ "xyz.fd.prism_payment": [...] }` */
export type UcpCheckoutPrepareResponse = Record<string, UcpCheckoutHandlerEntry[]>

// =====================================================
// ACP shapes (per Prism OpenAPI)
// =====================================================

/**
 * A single ACP handler descriptor. Used both for discovery (`config` is `{}`)
 * and for checkout-prepare (`config` is a `PaymentHandlerConfig`).
 */
export type AcpHandler = {
  id: string
  name: string
  version: string
  spec: string
  requires_delegate_payment: boolean
  requires_pci_compliance: boolean
  psp: string
  config_schema: string
  instrument_schemas: string[]
  config: PaymentHandlerConfig | Record<string, unknown>
}

// =====================================================
// x402 PaymentHandlerConfig — shared by UCP and ACP
// =====================================================

export type PaymentHandlerConfig = {
  x402Version: number
  resource: {
    url: string
    description?: string | null
  }
  accepts: X402AcceptEntry[]
}

export type X402AcceptEntry = {
  /** Payment scheme (e.g., "exact" for EIP-3009) */
  scheme: string
  /** Chain identifier in CAIP-2 format (e.g., "eip155:8453" for Base) */
  network: string
  /** Amount in token base units as string (e.g., "120000000" for 120 USDC) */
  amount?: string | null
  /** Token contract address */
  asset: string
  /** Merchant settlement address */
  payTo: string
  /** Maximum time for authorization validity */
  maxTimeoutSeconds: number
  /** Additional metadata (token name, version, etc.) */
  extra?: Record<string, unknown> | null
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

  // -------------------------------------------------
  // UCP
  // -------------------------------------------------

  /**
   * Fetch UCP handler descriptors for `.well-known/ucp` discovery.
   * Returns the raw Prism response keyed by handler namespace.
   */
  async fetchUcpHandlers(): Promise<UcpHandlersDiscoveryResponse> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty UCP handlers")
      return {}
    }
    return this.get<UcpHandlersDiscoveryResponse>("/api/v2/merchant/ucp/handlers")
  }

  /**
   * Convert a fiat amount to UCP-shaped x402 payment requirements for
   * a checkout session.
   */
  async prepareUcpPayment(input: PreparePaymentInput): Promise<UcpCheckoutPrepareResponse> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty UCP prepare")
      return {}
    }
    return this.post<UcpCheckoutPrepareResponse>(
      "/api/v2/merchant/ucp/payment-requirements",
      this.preparePayload(input),
    )
  }

  // -------------------------------------------------
  // ACP
  // -------------------------------------------------

  /**
   * Fetch ACP handler descriptors for `.well-known/acp.json` discovery.
   * Returns the raw Prism response (a flat array of handler objects).
   */
  async fetchAcpHandlers(): Promise<AcpHandler[]> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty ACP handlers")
      return []
    }
    return this.get<AcpHandler[]>("/api/v2/merchant/acp/handlers")
  }

  /**
   * Convert a fiat amount to a fully-formed ACP handler descriptor for
   * a checkout session (includes the resolved x402 config).
   */
  async prepareAcpPayment(input: PreparePaymentInput): Promise<AcpHandler> {
    if (!this.apiKey) {
      throw new Error("No PRISM_API_KEY configured")
    }
    return this.post<AcpHandler>(
      "/api/v2/merchant/acp/payment-requirements",
      this.preparePayload(input),
    )
  }

  // -------------------------------------------------
  // Internal helpers
  // -------------------------------------------------

  private preparePayload(input: PreparePaymentInput) {
    return {
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      resource: {
        url: input.resourceUrl,
        description: input.resourceDescription,
      },
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "GET",
      headers: { "X-API-Key": this.apiKey },
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      console.error(`[prism-client] GET ${path} failed (${response.status}): ${errorText}`)
      throw new Error(`Prism GET ${path} failed: ${response.status}`)
    }
    return response.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      console.error(`[prism-client] POST ${path} failed (${response.status}): ${errorText}`)
      throw new Error(`Prism POST ${path} failed: ${response.status}`)
    }
    return response.json() as Promise<T>
  }
}
