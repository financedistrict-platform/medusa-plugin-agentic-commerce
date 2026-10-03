import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import type {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  WebhookActionResult,
  PaymentSessionStatus,
} from "@medusajs/framework/types"
import type {
  PrismPaymentConfig,
  X402PaymentAuthorization,
  PrismSettleResponse,
  PrismVerifyResponse,
} from "./types"
import { PRISM_HANDLER_ID, isX402Instrument } from "./types"
import { PrismClient } from "../../lib/prism-client"

class PrismPaymentProviderService extends AbstractPaymentProvider<PrismPaymentConfig> {
  static identifier = "prism"

  private client: PrismClient
  private supportedChains: string[]
  private supportedAssets: string[]
  private autoCapture: boolean
  private verifyBeforeSettle: boolean

  constructor(cradle: Record<string, unknown>, config: PrismPaymentConfig) {
    super(cradle, config)

    this.client = new PrismClient({ apiUrl: config.api_url, apiKey: config.api_key })
    this.supportedChains = config.supported_chains || ["base"]
    this.supportedAssets = config.supported_assets || ["usdc"]
    this.autoCapture = config.auto_capture !== false
    this.verifyBeforeSettle = config.verify_before_settle !== false
  }

  static validateOptions(options: Record<string, unknown>) {
    if (!options.api_url) throw new Error("Prism payment provider requires api_url")
    if (!options.api_key) {
      console.warn("[prism-payment] No PRISM_API_KEY configured — Prism payment provider will run in passthrough mode")
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = crypto.randomUUID()
    const inputData = (input.data || {}) as Record<string, unknown>

    const data: Record<string, unknown> = {
      prism_session_id: sessionId,
      amount: input.amount,
      currency_code: input.currency_code,
      supported_chains: this.supportedChains,
      supported_assets: this.supportedAssets,
    }

    if (inputData.eip3009_authorization) {
      data.eip3009_authorization = inputData.eip3009_authorization
    }
    if (inputData.x402_version) {
      data.x402_version = inputData.x402_version
    }
    if (inputData.instrument_type) {
      data.instrument_type = inputData.instrument_type
    }
    if (inputData.ucp_version) {
      data.ucp_version = inputData.ucp_version
    }

    return { id: sessionId, data }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data || {}) as Record<string, unknown>
    const authorizationB64 = data.eip3009_authorization as string | undefined

    if (!authorizationB64) {
      console.warn("[prism-payment] No EIP-3009 authorization provided, auto-authorizing")
      return { data, status: "authorized" as PaymentSessionStatus }
    }

    let authorization: X402PaymentAuthorization
    try {
      const decoded = Buffer.from(authorizationB64, "base64").toString("utf-8")
      authorization = JSON.parse(decoded) as X402PaymentAuthorization
    } catch (error) {
      console.error("[prism-payment] Failed to decode authorization:", error)
      return {
        data: { ...data, error: "invalid_authorization_format" },
        status: "error" as PaymentSessionStatus,
      }
    }

    if (data.instrument_type !== undefined && !isX402Instrument(data.instrument_type, authorization)) {
      return {
        data: { ...data, error: "invalid_instrument_type" },
        status: "error" as PaymentSessionStatus,
      }
    }

    if (!authorization.paymentPayload?.payload?.authorization) {
      return {
        data: { ...data, error: "missing_eip3009_fields" },
        status: "error" as PaymentSessionStatus,
      }
    }

    const eip3009 = authorization.paymentPayload.payload.authorization

    const network = authorization.paymentPayload.network?.toLowerCase()
    if (network && !this.supportedChains.includes(network)) {
      return {
        data: { ...data, error: `unsupported_chain: ${network}` },
        status: "error" as PaymentSessionStatus,
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const validBefore = parseInt(eip3009.validBefore, 10)
    if (validBefore && validBefore < now) {
      return {
        data: { ...data, error: "authorization_expired" },
        status: "error" as PaymentSessionStatus,
      }
    }

    if (this.verifyBeforeSettle) {
      try {
        const verifyResult = await this.verifyWithPrism(authorization)
        if (!verifyResult.isValid) {
          return {
            data: { ...data, error: `prism_verification_failed: ${verifyResult.error ?? "unknown"}` },
            status: "error" as PaymentSessionStatus,
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("[prism-payment] Prism verification failed:", message)
      }
    }

    if (this.autoCapture) {
      try {
        const settleResult = await this.settleWithPrism(authorization)
        if (!settleResult.success) {
          const reason = settleResult.errorReason ?? "unknown"
          return {
            data: {
              ...data,
              error: `settlement_failed: ${reason}`,
              error_message: reason,
            },
            status: "error" as PaymentSessionStatus,
          }
        }

        const settledNetwork = settleResult.network ?? network
        return {
          data: {
            ...data,
            transaction_reference: settleResult.transaction,
            transaction_network: settledNetwork,
            prism_tx_id: settleResult.transaction,
            network: settledNetwork,
            payer: settleResult.payer ?? eip3009.from,
            amount: eip3009.value,
          },
          status: "authorized" as PaymentSessionStatus,
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("[prism-payment] Settlement failed:", message)
        return {
          data: { ...data, error: `settlement_error: ${message}` },
          status: "error" as PaymentSessionStatus,
        }
      }
    }

    return {
      data: {
        ...data,
        x402_authorization: authorizationB64,
        network,
        payer: eip3009.from,
        amount: eip3009.value,
        verified: true,
      },
      status: "authorized" as PaymentSessionStatus,
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    if (data.prism_tx_id) {
      return { data: { ...data, captured: true } }
    }

    const authorizationB64 = data.x402_authorization as string | undefined
    if (!authorizationB64) {
      return { data: { ...data, captured: true } }
    }

    try {
      const authorization = JSON.parse(
        Buffer.from(authorizationB64, "base64").toString("utf-8")
      ) as X402PaymentAuthorization

      const settleResult = await this.settleWithPrism(authorization)
      if (!settleResult.success) {
        throw new Error(
          `Settlement failed: ${settleResult.errorReason ?? "unknown"}`
        )
      }

      return {
        data: {
          ...data,
          transaction_reference: settleResult.transaction,
          transaction_network: settleResult.network,
          prism_tx_id: settleResult.transaction,
          captured: true,
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      throw new Error(`[prism-payment] Capture failed: ${message}`)
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return {
      data: {
        ...((input.data || {}) as Record<string, unknown>),
        canceled: true,
        canceled_at: new Date().toISOString(),
      },
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    console.warn("[prism-payment] Refund not yet implemented — manual processing required")
    return {
      data: {
        ...((input.data || {}) as Record<string, unknown>),
        refund_requested: true,
        refund_amount: String(input.amount),
        refund_status: "pending_manual",
      },
    }
  }

  async deletePayment(_input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: (input.data || {}) as Record<string, unknown> }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return {
      data: {
        ...((input.data || {}) as Record<string, unknown>),
        amount: input.amount,
        currency_code: input.currency_code,
      },
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    if (data.error) return { data, status: "error" as PaymentSessionStatus }
    if (data.captured || data.prism_tx_id) return { data, status: "captured" as PaymentSessionStatus }
    if (data.canceled) return { data, status: "canceled" as PaymentSessionStatus }
    if (data.verified || data.x402_authorization) return { data, status: "authorized" as PaymentSessionStatus }

    return { data, status: "pending" as PaymentSessionStatus }
  }

  async getWebhookActionAndData(
    _data: { data: Record<string, unknown>; rawData: string | Buffer; headers: Record<string, unknown> }
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" }
  }

  private paymentRequest(authorization: X402PaymentAuthorization) {
    return {
      x402Version: authorization.x402Version || 2,
      paymentPayload: authorization.paymentPayload,
      paymentRequirements: authorization.paymentRequirements,
    }
  }

  private async verifyWithPrism(authorization: X402PaymentAuthorization): Promise<PrismVerifyResponse> {
    const raw = await this.client.verifyPayment(this.paymentRequest(authorization))
    return {
      isValid: raw.isValid === true || raw.valid === true,
      payer: typeof raw.payer === "string" ? raw.payer : undefined,
      error:
        typeof raw.error === "string"
          ? raw.error
          : typeof raw.reason === "string"
            ? raw.reason
            : undefined,
    }
  }

  private async settleWithPrism(authorization: X402PaymentAuthorization): Promise<PrismSettleResponse> {
    const raw = await this.client.settlePayment(this.paymentRequest(authorization))
    const pickString = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = raw[k]
        if (typeof v === "string" && v.length > 0) return v
      }
      return undefined
    }
    return {
      success: raw.success !== false,
      payer: pickString("payer"),
      transaction: pickString("transaction", "transactionHash", "facilitatorTransactionId"),
      network: pickString("network"),
      errorReason: pickString("errorReason", "errorMessage", "errorCode"),
    }
  }
}

export default PrismPaymentProviderService
