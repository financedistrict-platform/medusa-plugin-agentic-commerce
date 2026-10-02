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
  available_instruments?: { type: string }[]
  config_schema?: string
  instrument_schemas?: string[]
  config: unknown
}

/** UCP discovery response: `{ "xyz.fd.prism_payment": [...] }` */
export type UcpHandlersDiscoveryResponse = Record<string, UcpHandlerDiscoveryEntry[]>

const PRISM_UCP_HANDLER_ID = "xyz.fd.prism_payment"
const PRISM_UCP_HANDLER_IDS: readonly unknown[] = [PRISM_UCP_HANDLER_ID, "x402"]

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function canonicalEntry(entry: unknown): UcpHandlerDiscoveryEntry | null {
  if (typeof entry !== "object" || entry === null) return null
  const raw = entry as Record<string, unknown>
  const schema = nonEmptyString(raw.schema) ? raw.schema : raw.config_schema
  if (!PRISM_UCP_HANDLER_IDS.includes(raw.id)) return null
  if (!nonEmptyString(raw.version) || !nonEmptyString(raw.spec) || !nonEmptyString(schema)) return null
  if (raw.available_instruments !== undefined && !Array.isArray(raw.available_instruments)) return null
  if (raw.instrument_schemas !== undefined && !Array.isArray(raw.instrument_schemas)) return null
  return { ...raw, id: PRISM_UCP_HANDLER_ID, schema } as UcpHandlerDiscoveryEntry
}

export function normalizeUcpHandlers(data: unknown): UcpHandlersDiscoveryResponse | null {
  if (typeof data !== "object" || data === null) return null
  const response = data as Record<string, unknown>
  const entries = response[PRISM_UCP_HANDLER_ID]
  if (!Array.isArray(entries) || entries.length === 0) return null
  const canonical = entries.map(canonicalEntry)
  if (canonical.some((entry) => entry === null)) return null
  return { ...(response as UcpHandlersDiscoveryResponse), [PRISM_UCP_HANDLER_ID]: canonical as UcpHandlerDiscoveryEntry[] }
}

export function isContractEntry(data: unknown): data is UcpHandlersDiscoveryResponse {
  return normalizeUcpHandlers(data) !== null
}

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

const UCP_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function userAgent(ucpVersion: string): string {
  if (typeof ucpVersion !== "string" || !UCP_VERSION_PATTERN.test(ucpVersion)) {
    throw new Error(
      `Prism call needs a UCP version date (YYYY-MM-DD) but got ${JSON.stringify(ucpVersion)}. ` +
        "Upgrade @financedistrict/medusa-plugin-agentic-commerce together with the prism-payment plugin.",
    )
  }
  return `fd-medusa-prism/${ucpVersion}`
}

export type PrismPaymentRequest = {
  x402Version: number
  paymentPayload: unknown
  paymentRequirements: unknown
}

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
  async fetchUcpHandlers(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty UCP handlers")
      return {}
    }
    return this.get<UcpHandlersDiscoveryResponse>("/api/v2/merchant/ucp/handlers", ucpVersion)
  }

  getApiUrl(): string {
    return this.apiUrl
  }

  /**
   * Convert a fiat amount to UCP-shaped x402 payment requirements for
   * a checkout session.
   */
  async prepareUcpPayment(input: PreparePaymentInput, ucpVersion: string): Promise<UcpCheckoutPrepareResponse> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty UCP prepare")
      return {}
    }
    return this.post<UcpCheckoutPrepareResponse>(
      "/api/v2/merchant/ucp/payment-requirements",
      this.preparePayload(input),
      ucpVersion,
    )
  }

  // -------------------------------------------------
  // ACP
  // -------------------------------------------------

  /**
   * Fetch ACP handler descriptors for `.well-known/acp.json` discovery.
   * Returns the raw Prism response (a flat array of handler objects).
   */
  async fetchAcpHandlers(ucpVersion: string): Promise<AcpHandler[]> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty ACP handlers")
      return []
    }
    return this.get<AcpHandler[]>("/api/v2/merchant/acp/handlers", ucpVersion)
  }

  /**
   * Convert a fiat amount to a fully-formed ACP handler descriptor for
   * a checkout session (includes the resolved x402 config).
   */
  async prepareAcpPayment(input: PreparePaymentInput, ucpVersion: string): Promise<AcpHandler> {
    if (!this.apiKey) {
      throw new Error("No PRISM_API_KEY configured")
    }
    return this.post<AcpHandler>(
      "/api/v2/merchant/acp/payment-requirements",
      this.preparePayload(input),
      ucpVersion,
    )
  }

  async verifyPayment(request: PrismPaymentRequest, ucpVersion: string): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(`/api/v${request.x402Version}/payment/verify`, request, ucpVersion)
  }

  async settlePayment(request: PrismPaymentRequest, ucpVersion: string): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(`/api/v${request.x402Version}/payment/settle`, request, ucpVersion)
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

  private async get<T>(path: string, ucpVersion: string): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "GET",
      headers: { "X-API-Key": this.apiKey, "User-Agent": userAgent(ucpVersion) },
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      console.error(`[prism-client] GET ${path} failed (${response.status}): ${errorText}`)
      throw new Error(`Prism GET ${path} failed: ${response.status}`)
    }
    return response.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown, ucpVersion: string): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        "User-Agent": userAgent(ucpVersion),
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
