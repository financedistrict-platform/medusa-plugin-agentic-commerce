
import type { PaymentHandlerAdapter, CheckoutPrepareInput } from "@financedistrict/medusa-plugin-agentic-commerce"
import {
  PrismClient,
  normalizeUcpHandlers,
  type AcpHandler,
  type PaymentHandlerConfig,
  type PreparePaymentInput,
  type UcpCheckoutPrepareResponse,
  type UcpHandlersDiscoveryResponse,
} from "../../lib/prism-client"
import { PRISM_HANDLER_ID } from "../prism-payment/types"

export const PRISM_CHECKOUT_DATA_KEY = "prism_checkout_data"

export const PRISM_CHECKOUT_CONFIG_KEY = "prism_checkout_config"

type PrismCheckoutData = {
  ucp: UcpCheckoutPrepareResponse | null
  acp: AcpHandler | null
  preparedAmount: string
  preparedResourceUrl: string
}

export type PrismPaymentHandlerOptions = {
  api_url?: string
  api_key?: string
}

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

  async getUcpDiscoveryHandlers(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    return this.fetchUcpDiscovery(ucpVersion)
  }

  async getAcpDiscoveryHandlers(): Promise<AcpHandler[]> {
    return this.fetchAcpDiscovery()
  }

  async prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<PrismCheckoutData | null> {
    const { cart, checkoutBaseUrl, storeName, ucpVersion, container } = input

    const totalMajor = cart.total ?? cart.raw_total?.value ?? 0
    const currency = (cart.currency_code || "eur").toUpperCase()
    const amount = String(Number(totalMajor))
    const resourceUrl = `${checkoutBaseUrl}/${cart.id}`

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

    const [ucpResult, acpResult] = await Promise.allSettled([
      this.prepareUcp(prepareInput, ucpVersion),
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

  getUcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): Record<string, unknown[]> {
    const data = cartMetadata?.[PRISM_CHECKOUT_DATA_KEY] as PrismCheckoutData | undefined
    return data?.ucp ?? {}
  }

  getAcpCheckoutHandlers(cartMetadata?: Record<string, unknown>): unknown[] {
    const data = cartMetadata?.[PRISM_CHECKOUT_DATA_KEY] as PrismCheckoutData | undefined
    return data?.acp ? [data.acp] : []
  }

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

  private async prepareUcp(input: PreparePaymentInput, ucpVersion: string): Promise<UcpCheckoutPrepareResponse> {
    const declaration = (await this.fetchUcpDiscovery(ucpVersion))[PRISM_HANDLER_ID]?.[0]
    if (!declaration) {
      throw new Error(`no ${PRISM_HANDLER_ID} declaration for UCP ${ucpVersion}`)
    }
    const config = await this.client.preparePayment(input)
    return { [PRISM_HANDLER_ID]: [{ id: declaration.id, version: declaration.version, config }] }
  }

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

  private async fetchAcpDiscovery(): Promise<AcpHandler[]> {
    const now = Date.now()
    const key = this.client.getApiUrl()
    const cached = this.acpDiscoveryCache.get(key)
    if (cached && now < cached.expiry) {
      return cached.data
    }
    try {
      const data = await this.client.fetchAcpHandlers()
      this.acpDiscoveryCache.set(key, { data, expiry: now + this.DISCOVERY_TTL })
      return data
    } catch (error: unknown) {
      console.error(`[prism-payment-handler] ACP discovery failed: ${error}`)
      return cached?.data ?? []
    }
  }
}
