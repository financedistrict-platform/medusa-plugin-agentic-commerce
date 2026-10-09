export type PreparePaymentInput = {
  amount: string
  currency: string
  resourceUrl: string
  resourceDescription: string
}

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

export type UcpCheckoutHandlerEntry = {
  id: string
  version: string
  config: PaymentHandlerConfig
}

export type UcpCheckoutPrepareResponse = Record<string, UcpCheckoutHandlerEntry[]>

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

export type PaymentHandlerConfig = {
  x402Version: number
  resource: {
    url: string
    description?: string | null
  }
  accepts: X402AcceptEntry[]
}

export type X402AcceptEntry = {
  scheme: string
  network: string
  amount?: string | null
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: Record<string, unknown> | null
}

const SUPPORTED_X402_VERSIONS: readonly number[] = [1, 2]

export function isSupportedX402Version(version: unknown): version is number {
  return typeof version === "number" && SUPPORTED_X402_VERSIONS.includes(version)
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

  async fetchUcpHandlers(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty UCP handlers")
      return {}
    }
    return this.get<UcpHandlersDiscoveryResponse>(`/ucp/${encodeURIComponent(ucpVersion)}/handlers`)
  }

  getApiUrl(): string {
    return this.apiUrl
  }

  getApiKey(): string {
    return this.apiKey
  }

  async preparePayment(input: PreparePaymentInput): Promise<PaymentHandlerConfig> {
    if (!this.apiKey) {
      throw new Error("No PRISM_API_KEY configured")
    }
    return this.post<PaymentHandlerConfig>(
      "/api/v2/merchant/payment-requirements",
      this.preparePayload(input),
    )
  }

  async fetchAcpHandlers(): Promise<AcpHandler[]> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty ACP handlers")
      return []
    }
    return this.get<AcpHandler[]>("/api/v2/merchant/acp/handlers")
  }

  async verifyPayment(request: PrismPaymentRequest): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(this.paymentPath(request, "verify"), request)
  }

  async settlePayment(request: PrismPaymentRequest): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(this.paymentPath(request, "settle"), request)
  }

  private paymentPath(request: PrismPaymentRequest, action: "verify" | "settle"): string {
    if (!isSupportedX402Version(request.x402Version)) {
      throw new Error(`Unsupported x402 version: ${String(request.x402Version)}`)
    }
    return `/api/v${request.x402Version}/payment/${action}`
  }

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
