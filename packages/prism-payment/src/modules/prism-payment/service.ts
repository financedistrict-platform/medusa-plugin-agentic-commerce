import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"
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
  PrismSettlementSummary,
  PrismVerifyResponse,
  SettledPayment,
} from "./types"
import { PRISM_HANDLER_ID, isX402Instrument } from "./types"
import { PrismClient, PrismHttpError, resolvePrismApiKey } from "../../lib/prism-client"
import { classifySettleReply, type SettlementState } from "../../lib/settlement-outcome"
import { PRISM_CHECKOUT_DATA_KEY } from "../prism-payment-handler/service"
import {
  asStoredQuote,
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

function manualRefundMessage(summary: PrismSettlementSummary | null): string {
  const base = "Prism payments settle on-chain and cannot be refunded automatically."
  const unavailable = `${base} The settlement summary is unavailable. Check the net amount received in the Prism portal before refunding the buyer manually.`
  if (summary?.status !== "confirmed") {
    return unavailable
  }
  const { net, asset, cashback, fee } = summary
  if (![net, asset, cashback, fee].every((value) => typeof value === "string" && value !== "")) {
    return unavailable
  }
  return `${base} Received ${net} ${asset} net (${cashback} ${asset} cashback already paid to the buyer, ${fee} ${asset} fees). Refund the buyer manually, up to ${net} ${asset}.`
}

type SettleAttempt =
  | { state: "settled"; payer?: string; settled: SettledPayment }
  | { state: Exclude<SettlementState, "settled">; error: string; reason?: string; transaction?: string }

function unsettledData(attempt: Exclude<SettleAttempt, { state: "settled" }>) {
  return {
    error: attempt.error,
    ...(attempt.reason ? { error_message: attempt.reason } : {}),
    ...(attempt.transaction ? { unreconciled_transaction: attempt.transaction } : {}),
  }
}

function failed(data: Record<string, unknown>, error: string, settlementState: SettlementState): AuthorizePaymentOutput {
  return {
    data: { ...data, error, settlement_state: settlementState },
    status: "error" as PaymentSessionStatus,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
    if (!resolvePrismApiKey(options.api_key)) {
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
    if (typeof inputData.credential_sha256 === "string" && inputData.credential_sha256.length > 0) {
      data.credential_sha256 = inputData.credential_sha256
    }
    if (inputData.settlement_resume === true) {
      data.settlement_resume = true
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
      if (mismatch) return failed(data, mismatch, "review")
      return { data: { ...data, settlement_state: "settled" }, status: "authorized" as PaymentSessionStatus }
    }

    const authorizationB64 = data.eip3009_authorization as string | undefined

    if (!authorizationB64) return failed(data, MISSING_PAYMENT_AUTHORIZATION, "declined")

    let authorization: X402PaymentAuthorization
    try {
      const decoded = Buffer.from(authorizationB64, "base64").toString("utf-8")
      authorization = JSON.parse(decoded) as X402PaymentAuthorization
    } catch (error) {
      console.error("[prism-payment] Failed to decode authorization:", error)
      return failed(data, "invalid_authorization_format", "declined")
    }

    if (data.instrument_type !== undefined && !isX402Instrument(data.instrument_type, authorization)) {
      return failed(data, "invalid_instrument_type", "declined")
    }

    if (!authorization?.paymentPayload?.payload?.authorization) {
      return failed(data, "missing_eip3009_fields", "declined")
    }

    const eip3009 = authorization.paymentPayload.payload.authorization

    const binding = this.bindToQuote(authorization, data)
    if (!binding.ok) return failed(data, binding.error, "declined")
    const network = binding.requirements.network.toLowerCase()

    if (this.verifyBeforeSettle) {
      try {
        const verifyResult = await this.verifyWithPrism(authorization, binding)
        if (!verifyResult.isValid) {
          return failed(data, `prism_verification_failed: ${verifyResult.error ?? "unknown"}`, "declined")
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("[prism-payment] Prism verification failed:", message)
        return failed(data, `prism_verification_error: ${message}`, "declined")
      }
    }

    if (this.autoCapture) {
      const attempt = await this.settleWithPrism(binding, data.settlement_resume === true)
      if (attempt.state !== "settled") {
        return {
          data: { ...data, ...unsettledData(attempt), settlement_state: attempt.state },
          status: "error" as PaymentSessionStatus,
        }
      }
      return {
        data: {
          ...data,
          ...settledPaymentData(attempt.settled),
          network: attempt.settled.network,
          payer: attempt.payer ?? eip3009.from,
          signed_value: eip3009.value,
          settlement_state: "settled",
        },
        status: "authorized" as PaymentSessionStatus,
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

      const attempt = await this.settleWithPrism(binding, false)
      if (attempt.state !== "settled") {
        if (attempt.transaction) {
          console.error(`[prism-payment] Settlement reported transaction ${attempt.transaction} that does not match the quote: ${attempt.reason ?? attempt.error}`)
        }
        throw new Error(
          `Settlement failed: ${attempt.reason ?? attempt.error}${attempt.transaction ? ` (transaction ${attempt.transaction})` : ""}`
        )
      }

      return {
        data: {
          ...data,
          ...settledPaymentData(attempt.settled),
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
    const data = (input.data ?? {}) as Record<string, unknown>
    const txHash = String(data.prism_tx_id ?? data.transaction_reference ?? "")
    const summary = txHash ? await this.client.fetchSettlementSummary(txHash).catch(() => null) : null
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, manualRefundMessage(summary))
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
    const { settlement_resume: _resume, ...data } = this.sessionDataFrom(sessionId, input)
    const keptQuote = data.payment_quote ?? asStoredQuote(inputData.payment_quote)
    return { data: keptQuote ? { ...data, payment_quote: keptQuote } : data }
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
      { resume: data.settlement_resume === true },
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

  private async settleWithPrism(target: SettlementTarget, resumed: boolean): Promise<SettleAttempt> {
    let raw: unknown
    try {
      raw = await this.client.settlePayment(this.paymentRequest(target))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      console.error("[prism-payment] Settlement failed:", message)
      const status = error instanceof PrismHttpError ? error.status : 0
      const state = classifySettleReply(status, null, resumed)
      return { state: state === "settled" ? "pending" : state, error: `settlement_error: ${message}` }
    }

    const reply = isRecord(raw) ? raw : {}
    const pickString = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = reply[k]
        if (typeof v === "string" && v.length > 0) return v
      }
      return undefined
    }
    const transaction = pickString("transaction", "transactionHash", "facilitatorTransactionId")
    const payer = pickString("payer")
    const state = classifySettleReply(200, raw, resumed)

    if (state !== "settled") {
      const reason = pickString("errorReason", "errorMessage", "errorCode")
        ?? (reply.success === true ? "missing_transaction_hash" : "settlement_not_confirmed")
      return { state, error: `settlement_failed: ${reason}`, reason, transaction }
    }
    const reconciled = reconcileSettlement(target.requirements, {
      transaction,
      network: pickString("network"),
      amount: reply.amount ?? reply.value,
    })
    if (!reconciled.ok) {
      return { state: "review", error: `settlement_failed: ${reconciled.error}`, reason: reconciled.error, transaction }
    }
    return { state: "settled", payer, settled: reconciled.settled }
  }
}

export default PrismPaymentProviderService
