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
import { PRISM_HANDLER_ID } from "./types"

/**
 * Prism Payment Provider for Medusa v2
 *
 * Handles stablecoin payments via the x402 protocol:
 * 1. Agent wallet signs EIP-3009 transferWithAuthorization (off-chain)
 * 2. Authorization is passed through ACP/UCP checkout complete
 * 3. This provider validates and forwards to Prism facilitator
 * 4. Prism executes the on-chain transfer
 *
 * Settlement flow:
 *   initiatePayment  -> stores amount/currency, returns session ID
 *   authorizePayment -> validates EIP-3009 authorization, optionally verifies with Prism
 *   capturePayment   -> calls Prism /api/v2/payment/settle for on-chain execution
 */
class PrismPaymentProviderService extends AbstractPaymentProvider<PrismPaymentConfig> {
  static identifier = "prism"

  private apiUrl: string
  private apiKey: string
  private supportedChains: string[]
  private supportedAssets: string[]
  private autoCapture: boolean
  private verifyBeforeSettle: boolean

  constructor(cradle: Record<string, unknown>, config: PrismPaymentConfig) {
    super(cradle, config)

    this.apiUrl = config.api_url
    this.apiKey = config.api_key
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

  // =====================================================
  // Core Payment Lifecycle
  // =====================================================

  /**
   * Called when a payment session is created for the cart.
   * Stores the payment amount and currency for later verification.
   */
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

    // Carry forward EIP-3009 authorization if provided during session creation
    if (inputData.eip3009_authorization) {
      data.eip3009_authorization = inputData.eip3009_authorization
    }
    if (inputData.x402_version) {
      data.x402_version = inputData.x402_version
    }

    return { id: sessionId, data }
  }

  /**
   * Called during cart completion (order placement).
   * Validates the EIP-3009 authorization and optionally verifies with Prism.
   *
   * If auto_capture is enabled, also settles the payment on-chain.
   */
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data || {}) as Record<string, unknown>
    const authorizationB64 = data.eip3009_authorization as string | undefined

    if (!authorizationB64) {
      // No authorization provided — system default fallback or test mode
      console.warn("[prism-payment] No EIP-3009 authorization provided, auto-authorizing")
      return { data, status: "authorized" as PaymentSessionStatus }
    }

    // Decode the base64-encoded x402 PaymentAuthorizationResult
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

    // Validate basic structure
    if (!authorization.paymentPayload?.payload?.authorization) {
      return {
        data: { ...data, error: "missing_eip3009_fields" },
        status: "error" as PaymentSessionStatus,
      }
    }

    const eip3009 = authorization.paymentPayload.payload.authorization

    // Verify chain is supported
    const network = authorization.paymentPayload.network?.toLowerCase()
    if (network && !this.supportedChains.includes(network)) {
      return {
        data: { ...data, error: `unsupported_chain: ${network}` },
        status: "error" as PaymentSessionStatus,
      }
    }

    // Verify the authorization hasn't expired
    const now = Math.floor(Date.now() / 1000)
    const validBefore = parseInt(eip3009.validBefore, 10)
    if (validBefore && validBefore < now) {
      return {
        data: { ...data, error: "authorization_expired" },
        status: "error" as PaymentSessionStatus,
      }
    }

    // Optionally verify with Prism before authorizing
    if (this.verifyBeforeSettle) {
      try {
        const verifyResult = await this.verifyWithPrism(authorization)
        if (!verifyResult.valid) {
          return {
            data: { ...data, error: `prism_verification_failed: ${verifyResult.reason}` },
            status: "error" as PaymentSessionStatus,
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("[prism-payment] Prism verification failed:", message)
        // Don't block on verification failure — settlement will catch actual issues
      }
    }

    // If auto_capture, settle immediately during authorization
    if (this.autoCapture) {
      try {
        const settleResult = await this.settleWithPrism(authorization)
        if (!settleResult.success) {
          return {
            data: {
              ...data,
              error: `settlement_failed: ${settleResult.errorCode}`,
              error_message: settleResult.errorMessage,
            },
            status: "error" as PaymentSessionStatus,
          }
        }

        return {
          data: {
            ...data,
            // Generic on-chain transaction keys (PSP-agnostic).
            // Every payment provider that settles on a blockchain should write
            // these under the same names so the agentic-commerce core plugin
            // can surface them in the UCP/ACP response without knowing which
            // PSP was used. Keep the Prism-specific keys below for existing
            // admin tooling.
            transaction_reference: settleResult.facilitatorTransactionId,
            transaction_status: settleResult.status,
            transaction_network: network,
            // Prism-specific keys (kept for backwards compatibility)
            prism_tx_id: settleResult.facilitatorTransactionId,
            prism_status: settleResult.status,
            settled_at: settleResult.acceptedAt,
            network,
            payer: eip3009.from,
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

    // Non-auto-capture: authorize only, settle on capture
    return {
      data: {
        ...data,
        x402_authorization: authorizationB64, // Preserve for capture step
        network,
        payer: eip3009.from,
        amount: eip3009.value,
        verified: true,
      },
      status: "authorized" as PaymentSessionStatus,
    }
  }

  /**
   * Called when admin captures the payment.
   * If auto_capture was used, this is a no-op (already settled).
   * Otherwise, calls Prism to execute the on-chain transfer.
   */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    // Already settled during authorization (auto_capture)
    if (data.prism_tx_id) {
      return { data: { ...data, captured: true } }
    }

    // Need to settle now
    const authorizationB64 = data.x402_authorization as string | undefined
    if (!authorizationB64) {
      // System default / test mode — auto-capture
      return { data: { ...data, captured: true } }
    }

    try {
      const authorization = JSON.parse(
        Buffer.from(authorizationB64, "base64").toString("utf-8")
      ) as X402PaymentAuthorization

      const settleResult = await this.settleWithPrism(authorization)
      if (!settleResult.success) {
        throw new Error(
          `Settlement failed: ${settleResult.errorCode} - ${settleResult.errorMessage}`
        )
      }

      return {
        data: {
          ...data,
          // Generic on-chain transaction keys (see authorizePayment for rationale)
          transaction_reference: settleResult.facilitatorTransactionId,
          transaction_status: settleResult.status,
          // Prism-specific keys (kept for backwards compatibility)
          prism_tx_id: settleResult.facilitatorTransactionId,
          prism_status: settleResult.status,
          settled_at: settleResult.acceptedAt,
          captured: true,
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      throw new Error(`[prism-payment] Capture failed: ${message}`)
    }
  }

  /**
   * Cancel an authorized payment.
   * For EIP-3009, the authorization simply expires (no on-chain action needed).
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return {
      data: {
        ...((input.data || {}) as Record<string, unknown>),
        canceled: true,
        canceled_at: new Date().toISOString(),
      },
    }
  }

  /**
   * Refund a captured payment.
   * Requires a reverse transfer via Prism (out of scope for Phase 4).
   */
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    // TODO: Phase 5 — implement reverse transfer via Prism
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

  /**
   * Delete a payment session (customer switches payment method).
   */
  async deletePayment(_input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  /**
   * Retrieve payment data from the provider.
   */
  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: (input.data || {}) as Record<string, unknown> }
  }

  /**
   * Update a payment session (e.g., cart total changed).
   */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return {
      data: {
        ...((input.data || {}) as Record<string, unknown>),
        amount: input.amount,
        currency_code: input.currency_code,
      },
    }
  }

  /**
   * Get current payment status from the provider.
   */
  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data || {}) as Record<string, unknown>

    if (data.error) return { data, status: "error" as PaymentSessionStatus }
    if (data.captured || data.prism_tx_id) return { data, status: "captured" as PaymentSessionStatus }
    if (data.canceled) return { data, status: "canceled" as PaymentSessionStatus }
    if (data.verified || data.x402_authorization) return { data, status: "authorized" as PaymentSessionStatus }

    return { data, status: "pending" as PaymentSessionStatus }
  }

  /**
   * Handle incoming webhooks from Prism (settlement confirmations, etc.)
   */
  async getWebhookActionAndData(
    _data: { data: Record<string, unknown>; rawData: string | Buffer; headers: Record<string, unknown> }
  ): Promise<WebhookActionResult> {
    // TODO: Phase 5 — handle Prism webhook events (settlement confirmed, failed, etc.)
    return { action: "not_supported" }
  }

  // =====================================================
  // Prism API Client Methods
  // =====================================================

  /**
   * Verify an EIP-3009 authorization with Prism before settlement.
   */
  private async verifyWithPrism(
    authorization: X402PaymentAuthorization
  ): Promise<PrismVerifyResponse> {
    const version = authorization.x402Version || 2
    const response = await fetch(`${this.apiUrl}/api/v${version}/payment/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        x402Version: version,
        paymentPayload: authorization.paymentPayload,
        paymentRequirements: authorization.paymentRequirements,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Prism verify returned ${response.status}: ${errorText}`)
    }

    return response.json() as Promise<PrismVerifyResponse>
  }

  /**
   * Settle (execute on-chain) an EIP-3009 authorization via Prism.
   */
  private async settleWithPrism(
    authorization: X402PaymentAuthorization
  ): Promise<PrismSettleResponse> {
    const version = authorization.x402Version || 2
    const response = await fetch(`${this.apiUrl}/api/v${version}/payment/settle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        x402Version: version,
        paymentPayload: authorization.paymentPayload,
        paymentRequirements: authorization.paymentRequirements,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Prism settle returned ${response.status}: ${errorText}`)
    }

    return response.json() as Promise<PrismSettleResponse>
  }
}

export default PrismPaymentProviderService
