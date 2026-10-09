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
  SettledPayment,
} from "./types"
import { PRISM_HANDLER_ID, isX402Instrument } from "./types"
import { PrismClient } from "../../lib/prism-client"
import { PRISM_CHECKOUT_DATA_KEY } from "../prism-payment-handler/service"
import {
  bindAuthorizationToQuote,
  reconcileSettlement,
  settledPaymentMismatch,
  storedQuoteFromCheckoutData,
  type QuotedRequirements,
} from "../../lib/quote-binding"

const MISSING_PAYMENT_AUTHORIZATION = "missing_payment_authorization"

type SettlementTarget = {
  x402Version: number
  requirements: QuotedRequirements
  paymentPayload: Record<string, unknown>
}

function settledPaymentData(settled: SettledPayment) {
  return {
    transaction_reference: settled.transaction,
    transaction_network: settled.network,
    prism_tx_id: settled.transaction,
    settled_amount: settled.amount,
    settled_asset: settled.asset,
  }
}

function unreconciledTransaction(settleResult: PrismSettleResponse) {
  return settleResult.transaction ? { unreconciled_transaction: settleResult.transaction } : {}
}

class PrismPaymentProviderService extends AbstractPaymentProvider<PrismPaymentConfig> {
  static identifier = "prism"

  private client: PrismClient
  private supportedAssets: string[]
  private allowedChains: string[] | undefined
  private autoCapture: boolean
  private verifyBeforeSettle: boolean

  constructor(cradle: Record<string, unknown>, config: PrismPaymentConfig) {
    super(cradle, config)

    this.client = new PrismClient({ apiUrl: config.api_url, apiKey: config.api_key })
    this.supportedAssets = config.supported_assets || ["usdc"]
    this.allowedChains = config.supported_chains
    this.autoCapture = config.auto_capture !== false
    this.verifyBeforeSettle = config.verify_before_settle !== false
  }

  static validateOptions(options: Record<string, unknown>) {
    if (!options.api_url) throw new Error("Prism payment provider requires api_url")
    if (!options.api_key && !process.env.PRISM_API_KEY) {
      throw new Error("Prism payment provider requires api_key or the PRISM_API_KEY environment variable; without it every Prism payment is rejected")
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = crypto.randomUUID()
    return { id: sessionId, data: this.sessionDataFrom(sessionId, input) }
  }

  private sessionDataFrom(
    sessionId: string,
    input: Pick<InitiatePaymentInput, "amount" | "currency_code" | "data">,
  ): Record<string, unknown> {
    const inputData = (input.data || {}) as Record<string, unknown>

    const data: Record<string, unknown> = {
      prism_session_id: sessionId,
      amount: input.amount,
      currency_code: input.currency_code,
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
    if (this.allowedChains) {
      data.supported_chains = this.allowedChains
    }
    const paymentQuote = storedQuoteFromCheckoutData(inputData[PRISM_CHECKOUT_DATA_KEY])
    if (paymentQuote) {
      data.payment_quote = paymentQuote
    } else if (inputData[PRISM_CHECKOUT_DATA_KEY]) {
      console.warn("[prism-payment] Stored Prism quote is unreadable or unsigned; authorization will be rejected")
    }

    return data
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    if (data.prism_tx_id) {
      const mismatch = settledPaymentMismatch(data, this.client.getApiKey())
      if (mismatch) {
        return {
          data: { ...data, error: mismatch },
          status: "error" as PaymentSessionStatus,
        }
      }
      return { data, status: "authorized" as PaymentSessionStatus }
    }

    const authorizationB64 = data.eip3009_authorization as string | undefined

    if (!authorizationB64) {
      return {
        data: { ...data, error: MISSING_PAYMENT_AUTHORIZATION },
        status: "error" as PaymentSessionStatus,
      }
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

    const binding = this.bindToQuote(authorization, data)
    if (!binding.ok) {
      return {
        data: { ...data, error: binding.error },
        status: "error" as PaymentSessionStatus,
      }
    }
    const network = binding.requirements.network.toLowerCase()

    if (this.verifyBeforeSettle) {
      try {
        const verifyResult = await this.verifyWithPrism(authorization, binding)
        if (!verifyResult.isValid) {
          return {
            data: { ...data, error: `prism_verification_failed: ${verifyResult.error ?? "unknown"}` },
            status: "error" as PaymentSessionStatus,
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("[prism-payment] Prism verification failed:", message)
        return {
          data: { ...data, error: `prism_verification_error: ${message}` },
          status: "error" as PaymentSessionStatus,
        }
      }
    }

    if (this.autoCapture) {
      try {
        const settleResult = await this.settleWithPrism(authorization, binding)
        if (!settleResult.success) {
          const reason = settleResult.errorReason ?? "unknown"
          return {
            data: {
              ...data,
              error: `settlement_failed: ${reason}`,
              error_message: reason,
              ...unreconciledTransaction(settleResult),
            },
            status: "error" as PaymentSessionStatus,
          }
        }

        const settled = settleResult.settled!
        return {
          data: {
            ...data,
            ...settledPaymentData(settled),
            network: settled.network,
            payer: settleResult.payer ?? eip3009.from,
            signed_value: eip3009.value,
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
        signed_value: eip3009.value,
        ...(this.verifyBeforeSettle ? { verified: true } : {}),
      },
      status: "authorized" as PaymentSessionStatus,
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    if (data.prism_tx_id) {
      const mismatch = settledPaymentMismatch(data, this.client.getApiKey())
      if (mismatch) {
        console.error(`[prism-payment] Refusing to capture settlement ${String(data.prism_tx_id)}: ${mismatch}`)
        throw new Error(`[prism-payment] Capture failed: ${mismatch}`)
      }
      return { data: { ...data, captured: true } }
    }

    const authorizationB64 = data.x402_authorization as string | undefined
    if (!authorizationB64) {
      throw new Error(`[prism-payment] Capture failed: ${MISSING_PAYMENT_AUTHORIZATION}`)
    }

    try {
      const authorization = JSON.parse(
        Buffer.from(authorizationB64, "base64").toString("utf-8")
      ) as X402PaymentAuthorization

      const binding = this.bindToQuote(authorization, data)
      if (!binding.ok) {
        throw new Error(binding.error)
      }

      const settleResult = await this.settleWithPrism(authorization, binding)
      if (!settleResult.success) {
        const unreconciled = unreconciledTransaction(settleResult)
        if (unreconciled.unreconciled_transaction) {
          console.error(`[prism-payment] Settlement reported transaction ${unreconciled.unreconciled_transaction} that does not match the quote: ${settleResult.errorReason}`)
        }
        throw new Error(
          `Settlement failed: ${settleResult.errorReason ?? "unknown"}${unreconciled.unreconciled_transaction ? ` (transaction ${unreconciled.unreconciled_transaction})` : ""}`
        )
      }

      return {
        data: {
          ...data,
          ...settledPaymentData(settleResult.settled!),
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
    const inputData = (input.data || {}) as Record<string, unknown>
    const sessionId = typeof inputData.prism_session_id === "string" ? inputData.prism_session_id : crypto.randomUUID()
    return { data: this.sessionDataFrom(sessionId, input) }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    if (data.error) return { data, status: "error" as PaymentSessionStatus }
    if (data.captured === true) return { data, status: "captured" as PaymentSessionStatus }
    if (data.canceled) return { data, status: "canceled" as PaymentSessionStatus }
    if (data.prism_tx_id || data.verified || data.x402_authorization) return { data, status: "authorized" as PaymentSessionStatus }

    return { data, status: "pending" as PaymentSessionStatus }
  }

  async getWebhookActionAndData(
    _data: { data: Record<string, unknown>; rawData: string | Buffer; headers: Record<string, unknown> }
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" }
  }

  private bindToQuote(authorization: X402PaymentAuthorization, data: Record<string, unknown>) {
    return bindAuthorizationToQuote(
      authorization,
      data.payment_quote,
      data.amount,
      data.currency_code,
      Math.floor(Date.now() / 1000),
      this.client.getApiKey(),
      this.allowedChains,
    )
  }

  private paymentRequest(target: SettlementTarget) {
    return {
      x402Version: target.x402Version,
      paymentPayload: target.paymentPayload,
      paymentRequirements: target.requirements,
    }
  }

  private async verifyWithPrism(
    authorization: X402PaymentAuthorization,
    target: SettlementTarget,
  ): Promise<PrismVerifyResponse> {
    const raw = await this.client.verifyPayment(this.paymentRequest(target))
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

  private async settleWithPrism(
    authorization: X402PaymentAuthorization,
    target: SettlementTarget,
  ): Promise<PrismSettleResponse> {
    const raw = await this.client.settlePayment(this.paymentRequest(target))
    const pickString = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = raw[k]
        if (typeof v === "string" && v.length > 0) return v
      }
      return undefined
    }
    const transaction = pickString("transaction", "transactionHash", "facilitatorTransactionId")
    const network = pickString("network")
    const payer = pickString("payer")
    const reportedReason = pickString("errorReason", "errorMessage", "errorCode")

    if (raw.success !== true) {
      return { success: false, payer, transaction, network, errorReason: reportedReason ?? "settlement_not_confirmed" }
    }
    const reconciled = reconcileSettlement(target.requirements, {
      transaction,
      network,
      amount: raw.amount ?? raw.value,
    })
    if (!reconciled.ok) {
      return { success: false, payer, transaction, network, errorReason: reconciled.error }
    }
    return { success: true, payer, transaction, network, settled: reconciled.settled }
  }
}

export default PrismPaymentProviderService
