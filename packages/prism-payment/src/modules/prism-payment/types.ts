/**
 * Types for the Prism Payment Provider
 *
 * Covers:
 * - EIP-3009 authorization structure (from Agent Wallet's authorizePayment tool)
 * - Prism facilitator API request/response
 * - Payment handler instrument schema for ACP/UCP
 */

// =====================================================
// EIP-3009 Authorization (what the agent wallet produces)
// =====================================================

/**
 * The credential payload inside an instrument of type "eip3009_authorization".
 * This is what the agent submits at checkout complete.
 *
 * Two modes:
 * - "payload" mode: Agent sends the full x402 PaymentAuthorizationResult
 *   (base64-encoded JSON containing paymentPayload + paymentRequirements)
 * - "raw" mode: Agent sends individual EIP-3009 fields (from, to, value, signature, etc.)
 */
export type Eip3009Credential = {
  /** Base64-encoded JSON of the full x402 PaymentAuthorizationResult */
  authorization: string
  /** x402 protocol version used (1 or 2). Defaults to 2. */
  x402_version?: number
}

/**
 * Decoded x402 PaymentAuthorizationResult
 * (what's inside the base64-encoded authorization string)
 */
export type X402PaymentAuthorization = {
  x402Version: number
  paymentPayload: X402PaymentPayload
  paymentRequirements: Record<string, unknown>
}

export type X402PaymentPayload = {
  x402Version: number
  scheme: string // "Exact" for EIP-3009
  network: string // "base", "ethereum", etc.
  payload: EvmPayloadData
}

export type EvmPayloadData = {
  signature: string // hex-encoded EIP-712/EIP-1271 signature
  authorization: Eip3009Authorization
}

export type Eip3009Authorization = {
  from: string // payer address
  to: string // recipient/merchant address
  value: string // amount in atomic units
  validAfter: string // unix timestamp
  validBefore: string // unix timestamp
  nonce: string // 64-byte hex
}

// =====================================================
// Prism Facilitator API
// =====================================================

/** Request to Prism Gateway POST /api/v2/payment/settle */
export type PrismSettleRequest = {
  x402Version: number
  paymentPayload: X402PaymentPayload
  paymentRequirements: Record<string, unknown>
}

/**
 * Response from Prism Gateway POST /api/v2/payment/settle.
 *
 * Matches the canonical `@1stdigital/prism-core` SDK shape: a successful 200 OK
 * returns `success: true, transaction: "0x…", network: "eip155:…", payer: "0x…"`.
 * On a logical-failure 200 (e.g., facilitator rejected after broadcast attempt),
 * `success: false` is paired with `errorReason: "<message>"`.
 *
 * Earlier internal builds returned `facilitatorTransactionId`, `errorMessage`,
 * `errorCode`. The provider's `settleWithPrism` parser accepts both shapes so a
 * future Prism rename can't silently re-break us.
 */
export type PrismSettleResponse = {
  success: boolean
  payer?: string
  /** EVM tx hash for the on-chain transfer */
  transaction?: string
  /** Chain id of the on-chain settlement (e.g. "eip155:84532") */
  network?: string
  /** Reason string when `success: false` */
  errorReason?: string
}

/** Request to Prism Gateway POST /api/v2/payment/verify */
export type PrismVerifyRequest = PrismSettleRequest

/**
 * Response from Prism Gateway POST /api/v2/payment/verify.
 *
 * Matches the canonical `@1stdigital/prism-core` SDK shape: `isValid: boolean`
 * (with `payer` populated on success and `error` populated on failure).
 *
 * Earlier internal builds returned `{ valid, reason }`. The provider's
 * `verifyWithPrism` parser accepts both shapes for forward+backward compat.
 */
export type PrismVerifyResponse = {
  isValid: boolean
  payer?: string
  error?: string
}

// =====================================================
// Provider Configuration
// =====================================================

export type PrismPaymentConfig = {
  /** Prism Gateway API base URL */
  api_url: string
  /** API key for Prism Gateway authentication (identifies merchant + settlement config) */
  api_key: string
  /** Supported chains (default: ["base"]) */
  supported_chains?: string[]
  /** Supported assets (default: ["usdc"]) */
  supported_assets?: string[]
  /** Whether to auto-capture on authorization (default: true) */
  auto_capture?: boolean
  /** Whether to verify authorization before settling (default: true) */
  verify_before_settle?: boolean
}

// =====================================================
// Handler / Instrument Schema (for protocol discovery)
// =====================================================

/**
 * The instrument schema for xyz.fd.prism_payment handler.
 * Published in ACP/UCP discovery so agents know what to submit.
 */
export const PRISM_HANDLER_ID = "xyz.fd.prism_payment"

export const PRISM_INSTRUMENT_SCHEMA = {
  type: "eip3009_authorization",
  credential_schema: {
    type: "object",
    required: ["authorization"],
    properties: {
      authorization: {
        type: "string",
        description: "Base64-encoded JSON of the x402 PaymentAuthorizationResult from the agent wallet's authorizePayment tool",
      },
      x402_version: {
        type: "integer",
        enum: [1, 2],
        default: 2,
        description: "x402 protocol version",
      },
    },
  },
} as const
