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
import { isX402Instrument } from "./types"
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
import { credentialSha256, currentCredentialHandoff } from "../../lib/credential-handoff"
import {
  prismSessionData,
  recordedSettlement,
  sessionBaseOf,
  settledOutcome,
  type PrismSessionBase,
  type PrismSessionData,
} from "./session-data"

const MISSING_PAYMENT_AUTHORIZATION = "missing_payment_authorization"
export const CREDENTIAL_HANDOFF_MISSING = "credential_handoff_missing"
export const CREDENTIAL_HANDOFF_MISMATCH = "credential_handoff_mismatch"
export const UNEXPECTED_RECORDED_SETTLEMENT = "unexpected_recorded_settlement"

const REDACTED_REASON = "unreadable_reason"
const MAX_REASON_LENGTH = 200
const LONG_ENCODED_RUN = /[A-Za-z0-9+/=_-]{64,}/

function safeReason(reason: string): string {
  return reason.length > MAX_REASON_LENGTH || LONG_ENCODED_RUN.test(reason) ? REDACTED_REASON : reason
}

type SettlementTarget = {
  x402Version: number
  requirements: QuotedRequirements
  paymentPayload: Record<string, unknown>
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

function failed(base: PrismSessionBase, error: string, settlementState: SettlementState): AuthorizePaymentOutput {
  return {
    data: prismSessionData(base, { error, settlement_state: settlementState }),
    status: "error" as PaymentSessionStatus,
  }
}

function unsettled(base: PrismSessionBase, attempt: Exclude<SettleAttempt, { state: "settled" }>): AuthorizePaymentOutput {
  return {
    data: prismSessionData(base, {
      error: attempt.error,
      error_message: attempt.reason ?? null,
      unreconciled_transaction: attempt.transaction ?? null,
      settlement_state: attempt.state,
    }),
    status: "error" as PaymentSessionStatus,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function decodeAuthorization(credential: string): X402PaymentAuthorization | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(credential, "base64").toString("utf-8"))
    return isRecord(decoded) ? (decoded as X402PaymentAuthorization) : null
  } catch {
    return null
  }
}

class PrismPaymentProviderService extends AbstractPaymentProvider<PrismPaymentConfig> {
  static identifier = "prism"

  private client: PrismClient
  private supportedAssets: string[]
  private allowedChains: string[] | undefined
  private verifyBeforeSettle: boolean

  constructor(cradle: Record<string, unknown>, config: PrismPaymentConfig) {
    super(cradle, config)

    this.client = new PrismClient({ apiUrl: config.api_url, apiKey: config.api_key })
    this.supportedAssets = config.supported_assets || ["usdc"]
    this.allowedChains = config.supported_chains
    this.verifyBeforeSettle = config.verify_before_settle !== false
  }

  static validateOptions(options: Record<string, unknown>) {
    if (!options.api_url) throw new Error("Prism payment provider requires api_url")
    if (!resolvePrismApiKey(options.api_key)) {
      throw new Error("Prism payment provider requires api_key or the PRISM_API_KEY environment variable; without it every Prism payment is rejected")
    }
    if (options.auto_capture === false) {
      throw new Error("Prism payment provider settles while authorizing; auto_capture: false is not supported")
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = crypto.randomUUID()
    return { id: sessionId, data: this.sessionDataFrom(sessionId, input) }
  }

  private sessionBase(data: Record<string, unknown>): PrismSessionBase {
    return sessionBaseOf(data, { supportedAssets: this.supportedAssets, supportedChains: this.allowedChains })
  }

  private sessionDataFrom(
    sessionId: string,
    input: Pick<InitiatePaymentInput, "amount" | "currency_code" | "data">,
  ): PrismSessionData {
    const inputData = (input.data || {}) as Record<string, unknown>
    const paymentQuote = storedQuoteFromCheckoutData(inputData[PRISM_CHECKOUT_DATA_KEY])
    if (!paymentQuote && inputData[PRISM_CHECKOUT_DATA_KEY]) {
      console.warn("[prism-payment] Stored Prism quote is unreadable or unsigned; authorization will be rejected")
    }
    return prismSessionData({
      ...this.sessionBase(inputData),
      prism_session_id: sessionId,
      amount: input.amount,
      currency_code: input.currency_code,
      payment_quote: paymentQuote,
    })
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data || {}) as Record<string, unknown>
    const base = this.sessionBase(data)

    const handoff = currentCredentialHandoff()
    if (!handoff) return failed(base, CREDENTIAL_HANDOFF_MISSING, "declined")
    if (!base.credential_sha256 || credentialSha256(handoff.credential) !== base.credential_sha256) {
      return failed(base, CREDENTIAL_HANDOFF_MISMATCH, "declined")
    }

    if (data.prism_tx_id) return failed(base, UNEXPECTED_RECORDED_SETTLEMENT, "review")

    const authorization = decodeAuthorization(handoff.credential)
    if (!authorization) return failed(base, "invalid_authorization_format", "declined")

    if (base.instrument_type !== null && !isX402Instrument(base.instrument_type, authorization)) {
      return failed(base, "invalid_instrument_type", "declined")
    }

    if (!authorization.paymentPayload?.payload?.authorization) {
      return failed(base, "missing_eip3009_fields", "declined")
    }

    const eip3009 = authorization.paymentPayload.payload.authorization
    const resumed = handoff.settlementResume

    const binding = this.bindToQuote(authorization, base, resumed)
    if (!binding.ok) return failed(base, binding.error, "declined")

    if (this.verifyBeforeSettle && !resumed) {
      try {
        const verifyResult = await this.verifyWithPrism(authorization, binding)
        if (!verifyResult.isValid) {
          return failed(base, `prism_verification_failed: ${safeReason(verifyResult.error ?? "unknown")}`, "declined")
        }
      } catch (error: unknown) {
        const message = safeReason(error instanceof Error ? error.message : "Unknown error")
        console.error("[prism-payment] Prism verification failed:", message)
        return failed(base, `prism_verification_error: ${message}`, "declined")
      }
    }

    const attempt = await this.settleWithPrism(binding, resumed)
    if (attempt.state !== "settled") return unsettled(base, attempt)
    return {
      data: prismSessionData(base, {
        ...settledOutcome(attempt.settled),
        network: attempt.settled.network,
        payer: attempt.payer ?? eip3009.from,
        signed_value: eip3009.value,
      }),
      status: "authorized" as PaymentSessionStatus,
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    if (!data.prism_tx_id) {
      throw new Error(`[prism-payment] Capture failed: ${MISSING_PAYMENT_AUTHORIZATION}`)
    }
    const mismatch = settledPaymentMismatch(data, this.client.getApiKey())
    if (mismatch) {
      console.error(`[prism-payment] Refusing to capture settlement ${String(data.prism_tx_id)}: ${mismatch}`)
      throw new Error(`[prism-payment] Capture failed: ${mismatch}`)
    }
    return { data: prismSessionData(this.sessionBase(data), { ...recordedSettlement(data), captured: true }) }
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
    const data = this.sessionDataFrom(sessionId, input)
    return { data: { ...data, payment_quote: data.payment_quote ?? asStoredQuote(inputData.payment_quote) } }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    if (data.error) return { data, status: "error" as PaymentSessionStatus }
    if (data.captured === true) return { data, status: "captured" as PaymentSessionStatus }
    if (data.canceled) return { data, status: "canceled" as PaymentSessionStatus }
    if (data.prism_tx_id) return { data, status: "authorized" as PaymentSessionStatus }

    return { data, status: "pending" as PaymentSessionStatus }
  }

  async getWebhookActionAndData(
    _data: { data: Record<string, unknown>; rawData: string | Buffer; headers: Record<string, unknown> }
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" }
  }

  private bindToQuote(authorization: X402PaymentAuthorization, base: PrismSessionBase, resumed: boolean) {
    return bindAuthorizationToQuote(
      authorization,
      base.payment_quote,
      base.amount,
      base.currency_code,
      Math.floor(Date.now() / 1000),
      this.client.getApiKey(),
      this.allowedChains,
      { resume: resumed },
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
      const message = safeReason(error instanceof Error ? error.message : "Unknown error")
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
      const reported = pickString("errorReason", "errorMessage", "errorCode")
      const reason = reported !== undefined ? safeReason(reported)
        : reply.success === true ? "missing_transaction_hash" : "settlement_not_confirmed"
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
