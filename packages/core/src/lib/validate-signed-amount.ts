/**
 * Validate the agent's signed x402 payment payload against the cart's
 * stored Prism quote on (network, asset, amount, recipient). Strict
 * equality on amount — FX and buffer are baked in at prepare time.
 */

// =====================================================
// Public types
// =====================================================

export type SignedPaymentSummary = {
  /** Chain identifier — e.g., "eip155:84532" */
  network: string
  /** Token contract address — case-insensitive comparison */
  asset: string
  /** EIP-3009 signed `value` as an atomic-unit string */
  value: string
  /** EIP-3009 signed recipient (`authorization.to`) — case-insensitive */
  to: string
  /** EIP-3009 signed payer (`authorization.from`) — case-insensitive */
  payer: string
  /** EIP-3009 signed nonce (`authorization.nonce`) — case-insensitive */
  nonce: string
  /** Amount named by the declared requirements (`accepted.amount`) */
  declaredAmount: string
  /** Recipient named by the declared requirements (`accepted.payTo`) — case-insensitive */
  declaredPayTo: string
}

export type StoredAcceptEntry = {
  network: string
  asset: string
  amount: string
  /** Merchant's expected settlement address */
  payTo: string
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: ValidationErrorCode; message: string }

export type ValidationErrorCode =
  | "no_payment_quote"
  | "no_matching_accepts_entry"
  | "amount_mismatch"
  | "wrong_recipient"
  | "declared_requirements_mismatch"

export function extractSignedSummary(authorizationB64: string): SignedPaymentSummary | null {
  const decoded = decodeBase64Json(authorizationB64)
  if (!isRecord(decoded) || !isRecord(decoded.paymentPayload)) return null

  const { accepted, payload } = decoded.paymentPayload
  const authz = isRecord(payload) ? payload.authorization : undefined
  const network = readNonEmptyString(accepted, "network")
  const asset = readNonEmptyString(accepted, "asset")
  const value = readNonEmptyString(authz, "value")
  const to = readNonEmptyString(authz, "to")
  const payer = readNonEmptyString(authz, "from")
  const nonce = readNonEmptyString(authz, "nonce")
  const declaredAmount = readNonEmptyString(accepted, "amount")
  const declaredPayTo = readNonEmptyString(accepted, "payTo")

  if (!network || !asset || !value || !to || !payer || !nonce || !declaredAmount || !declaredPayTo || !ATOMIC_UNITS.test(value)) return null
  if (!EVM_ADDRESS.test(payer) || !BYTES32_HEX.test(nonce)) return null
  return { network, asset, value, to, payer, nonce, declaredAmount, declaredPayTo }
}

const ATOMIC_UNITS = /^[0-9]+$/
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/

function decodeBase64Json(b64: string): unknown {
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"))
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// =====================================================
// Stored-quote reader
// =====================================================

/**
 * Read the cart's stored Prism accepts[] for the given handler and
 * protocol. Returns null if the cart wasn't prepared for Prism.
 * The stored quote is what the prism-payment handler returned at
 * prepare time, kept in the plugin's agent session.
 */
export function readStoredPrismAccepts(
  storedQuote: unknown,
  handlerId: string | undefined,
  protocol: "ucp" | "acp",
): StoredAcceptEntry[] | null {
  if (typeof storedQuote !== "object" || storedQuote === null) return null
  const d = storedQuote as Record<string, unknown>

  if (protocol === "ucp") {
    if (!handlerId) return null
    const ucp = d.ucp
    if (typeof ucp !== "object" || ucp === null) return null
    const entries = (ucp as Record<string, unknown>)[handlerId]
    if (!Array.isArray(entries) || entries.length === 0) return null
    const first = entries[0] as Record<string, unknown>
    const config = first?.config as Record<string, unknown> | undefined
    return readAcceptsFromConfig(config)
  }

  // ACP
  const acp = d.acp
  if (typeof acp !== "object" || acp === null) return null
  const config = (acp as Record<string, unknown>).config as Record<string, unknown> | undefined
  return readAcceptsFromConfig(config)
}

function readAcceptsFromConfig(
  config: Record<string, unknown> | undefined,
): StoredAcceptEntry[] | null {
  if (!config) return null
  const accepts = config.accepts
  if (!Array.isArray(accepts)) return null
  const filtered = accepts.filter(
    (a): a is StoredAcceptEntry =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as Record<string, unknown>).network === "string" &&
      typeof (a as Record<string, unknown>).asset === "string" &&
      typeof (a as Record<string, unknown>).amount === "string" &&
      typeof (a as Record<string, unknown>).payTo === "string",
  )
  return filtered.length > 0 ? filtered : null
}

// =====================================================
// Validation
// =====================================================

/**
 * Validate the signed summary against the cart's stored accepts.
 * Strict equality on network (exact), asset & recipient (case-insensitive
 * for address checksum tolerance), and amount (BigInt comparison).
 */
export function validateSignedAgainstStored(
  summary: SignedPaymentSummary,
  storedAccepts: StoredAcceptEntry[] | null,
): ValidationResult {
  if (!storedAccepts || storedAccepts.length === 0) {
    return {
      ok: false,
      code: "no_payment_quote",
      message:
        "No payment quote found on the cart. Prepare payment before completing.",
    }
  }

  const match = storedAccepts.find(
    (a) => a.network === summary.network && sameAddress(a.asset, summary.asset),
  )

  if (!match) {
    const quoted = storedAccepts
      .map((a) => `(${a.network}, ${a.asset})`)
      .join(", ")
    return {
      ok: false,
      code: "no_matching_accepts_entry",
      message: `Signed payment uses (${summary.network}, ${summary.asset}) but the cart was quoted for: ${quoted}.`,
    }
  }

  if (!sameAtomicValue(match.amount, summary.declaredAmount) || !sameAddress(match.payTo, summary.declaredPayTo)) {
    return {
      ok: false,
      code: "declared_requirements_mismatch",
      message: `The payment requirements declared in the credential do not match the cart's payment quote.`,
    }
  }

  if (!sameAtomicValue(match.amount, summary.value)) {
    return {
      ok: false,
      code: "amount_mismatch",
      message: `Signed value (${summary.value}) does not match the cart's quoted amount (${match.amount}) for asset ${summary.asset} on ${summary.network}.`,
    }
  }

  if (!sameAddress(match.payTo, summary.to)) {
    return {
      ok: false,
      code: "wrong_recipient",
      message: `Signed payment recipient does not match the merchant's settlement address. Re-sign with the correct recipient.`,
    }
  }

  return { ok: true }
}

// =====================================================
// Internal helpers
// =====================================================

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function sameAtomicValue(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

function readNonEmptyString(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined
  const v = obj[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}
