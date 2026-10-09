import { createHmac, timingSafeEqual } from "node:crypto"
import { isSupportedX402Version, type PaymentHandlerConfig, type X402AcceptEntry } from "./prism-client"
import type { SettledPayment, X402PaymentAuthorization } from "../modules/prism-payment/types"

export type QuotedRequirements = X402AcceptEntry & { amount: string }

type QuoteTerms = {
  x402Version: number
  preparedAmount: string
  preparedCurrency: string
  preparedResourceUrl: string
  accepts: QuotedRequirements[]
}

export type StoredQuote = QuoteTerms & { signature: string }

export type QuoteBindingError =
  | "missing_payment_quote"
  | "invalid_quote_signature"
  | "quote_total_mismatch"
  | "quote_currency_mismatch"
  | "missing_eip3009_fields"
  | "no_matching_quote_entry"
  | "accepted_requirements_mismatch"
  | "unsupported_chain"
  | "amount_mismatch"
  | "wrong_recipient"
  | "authorization_expired"
  | "authorization_not_yet_valid"
  | "invalid_nonce"

export type SettlementError = "missing_transaction_hash" | "settled_network_mismatch" | "settled_amount_mismatch"

type SessionQuoteError = "missing_payment_quote" | "invalid_quote_signature" | "quote_total_mismatch" | "quote_currency_mismatch"

export type SettledPaymentMismatch = SessionQuoteError | SettlementError | "settled_payment_not_quoted"

export type ReportedSettlement = {
  transaction?: string
  network?: string
  amount?: unknown
}

export type SettlementReconciliation =
  | { ok: true; settled: SettledPayment }
  | { ok: false; error: SettlementError }

export type QuoteBinding =
  | { ok: true; x402Version: number; requirements: QuotedRequirements; paymentPayload: Record<string, unknown> }
  | { ok: false; error: QuoteBindingError }

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/
const UNSIGNED_INTEGER = /^\d+$/

const CHAIN_ALIASES: Record<string, string> = {
  ethereum: "eip155:1",
  optimism: "eip155:10",
  polygon: "eip155:137",
  base: "eip155:8453",
  arbitrum: "eip155:42161",
  sepolia: "eip155:11155111",
  "base-sepolia": "eip155:84532",
}

export function paymentConfigFromCheckoutData(checkoutData: unknown): PaymentHandlerConfig | null {
  if (!isRecord(checkoutData)) return null
  const ucpEntries = isRecord(checkoutData.ucp) ? Object.values(checkoutData.ucp)[0] : undefined
  const ucpConfig = Array.isArray(ucpEntries) && isRecord(ucpEntries[0]) ? ucpEntries[0].config : undefined
  if (isPaymentHandlerConfig(ucpConfig)) return ucpConfig
  const acpConfig = isRecord(checkoutData.acp) ? checkoutData.acp.config : undefined
  return isPaymentHandlerConfig(acpConfig) ? acpConfig : null
}

export function quoteSignatureFor(checkoutData: unknown, signingKey: string): string | null {
  const terms = quoteTermsFromCheckoutData(checkoutData)
  return terms && signingKey ? sign(terms, signingKey) : null
}

export function hasValidQuoteSignature(checkoutData: unknown, signingKey: string): boolean {
  const quote = storedQuoteFromCheckoutData(checkoutData)
  return quote !== null && signatureMatches(quote, signingKey)
}

export function storedQuoteFromCheckoutData(checkoutData: unknown): StoredQuote | null {
  const terms = quoteTermsFromCheckoutData(checkoutData)
  if (!terms || !isRecord(checkoutData)) return null
  return asStoredQuote({ ...terms, signature: checkoutData.quoteSignature })
}

export function bindAuthorizationToQuote(
  authorization: X402PaymentAuthorization,
  storedQuote: unknown,
  sessionAmount: unknown,
  sessionCurrency: unknown,
  nowSeconds: number,
  signingKey: string,
  allowedChains?: readonly string[],
): QuoteBinding {
  const checked = quoteForSession(storedQuote, sessionAmount, sessionCurrency, signingKey)
  if (!checked.ok) return fail(checked.error)
  const quote = checked.quote

  const signed = authorization.paymentPayload?.payload?.authorization
  if (!signed || !allNonEmpty(authorization.paymentPayload?.payload?.signature, signed.from, signed.to, signed.value, signed.validAfter, signed.validBefore, signed.nonce)) {
    return fail("missing_eip3009_fields")
  }

  const declared = declaredRequirements(authorization)
  const requirements = declared ? quotedEntryFor(declared, quote) : null
  if (!declared || !requirements) return fail("no_matching_quote_entry")
  if (!declaresQuotedTerms(declared, requirements)) return fail("accepted_requirements_mismatch")
  if (!chainAllowed(requirements.network, allowedChains)) return fail("unsupported_chain")
  if (!sameAtomicValue(requirements.amount, signed.value)) return fail("amount_mismatch")
  if (!sameAddress(requirements.payTo, signed.to)) return fail("wrong_recipient")
  if (!UNSIGNED_INTEGER.test(signed.validBefore) || Number(signed.validBefore) <= nowSeconds) return fail("authorization_expired")
  if (!UNSIGNED_INTEGER.test(signed.validAfter) || Number(signed.validAfter) > nowSeconds) return fail("authorization_not_yet_valid")
  if (!BYTES32_HEX.test(signed.nonce)) return fail("invalid_nonce")

  return { ok: true, x402Version: quote.x402Version, requirements, paymentPayload: quotedPayload(authorization, quote, requirements) }
}

export function reconcileSettlement(requirements: QuotedRequirements, reported: ReportedSettlement): SettlementReconciliation {
  if (!allNonEmpty(reported.transaction)) return { ok: false, error: "missing_transaction_hash" }
  if (reported.network !== undefined && chainKey(reported.network) !== chainKey(requirements.network)) {
    return { ok: false, error: "settled_network_mismatch" }
  }
  if (reported.amount !== undefined && !sameReportedAtomicValue(requirements.amount, reported.amount)) {
    return { ok: false, error: "settled_amount_mismatch" }
  }
  return {
    ok: true,
    settled: {
      transaction: reported.transaction as string,
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.amount,
    },
  }
}

export function settledPaymentMismatch(sessionData: Record<string, unknown>, signingKey: string): SettledPaymentMismatch | null {
  const checked = quoteForSession(sessionData.payment_quote, sessionData.amount, sessionData.currency_code, signingKey)
  if (!checked.ok) return checked.error
  if (!allNonEmpty(sessionData.prism_tx_id)) return "missing_transaction_hash"

  const { transaction_network: network, settled_asset: asset, settled_amount: amount } = sessionData
  const quoted = allNonEmpty(network, asset)
    ? checked.quote.accepts.find((entry) => chainKey(entry.network) === chainKey(network as string) && sameAddress(entry.asset, asset as string))
    : undefined
  if (!quoted) return "settled_payment_not_quoted"
  return typeof amount === "string" && sameAtomicValue(quoted.amount, amount) ? null : "settled_amount_mismatch"
}

function quoteForSession(
  storedQuote: unknown,
  sessionAmount: unknown,
  sessionCurrency: unknown,
  signingKey: string,
): { ok: true; quote: StoredQuote } | { ok: false; error: SessionQuoteError } {
  const quote = asStoredQuote(storedQuote)
  if (!quote) return { ok: false, error: "missing_payment_quote" }
  if (!signatureMatches(quote, signingKey)) return { ok: false, error: "invalid_quote_signature" }
  if (!sameDecimal(quote.preparedAmount, sessionAmount)) return { ok: false, error: "quote_total_mismatch" }
  if (!sameCurrency(quote.preparedCurrency, sessionCurrency)) return { ok: false, error: "quote_currency_mismatch" }
  return { ok: true, quote }
}

function sameReportedAtomicValue(expected: string, reported: unknown): boolean {
  if (typeof reported === "string") return sameAtomicValue(expected, reported)
  return typeof reported === "number" && Number.isSafeInteger(reported) && reported >= 0 && sameAtomicValue(expected, String(reported))
}

function declaredRequirements(authorization: X402PaymentAuthorization): Record<string, unknown> | null {
  const payload = authorization.paymentPayload as unknown as Record<string, unknown> | undefined
  return isRecord(payload?.accepted) ? payload.accepted : null
}

function quotedEntryFor(declared: Record<string, unknown>, quote: StoredQuote): QuotedRequirements | null {
  const network = firstString(declared.network)
  const asset = firstString(declared.asset)
  if (!network || !asset) return null
  return quote.accepts.find((entry) => entry.network === network && sameAddress(entry.asset, asset)) ?? null
}

function declaresQuotedTerms(declared: Record<string, unknown>, quoted: QuotedRequirements): boolean {
  return (
    typeof declared.scheme === "string" &&
    declared.scheme.toLowerCase() === quoted.scheme.toLowerCase() &&
    typeof declared.amount === "string" &&
    sameAtomicValue(declared.amount, quoted.amount) &&
    typeof declared.payTo === "string" &&
    sameAddress(declared.payTo, quoted.payTo)
  )
}

function quotedPayload(
  authorization: X402PaymentAuthorization,
  quote: StoredQuote,
  requirements: QuotedRequirements,
): Record<string, unknown> {
  const { signature, authorization: signed } = authorization.paymentPayload.payload
  const { from, to, value, validAfter, validBefore, nonce } = signed
  return {
    x402Version: quote.x402Version,
    accepted: requirements,
    payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce } },
  }
}

function chainAllowed(network: string, allowedChains: readonly string[] | undefined): boolean {
  return allowedChains === undefined || allowedChains.some((chain) => chainKey(chain) === chainKey(network))
}

function chainKey(chain: string): string {
  const key = chain.trim().toLowerCase()
  return CHAIN_ALIASES[key] ?? key
}

function quoteTermsFromCheckoutData(checkoutData: unknown): QuoteTerms | null {
  const config = paymentConfigFromCheckoutData(checkoutData)
  if (!config || !isRecord(checkoutData)) return null
  return asQuoteTerms({
    x402Version: config.x402Version,
    preparedAmount: checkoutData.preparedAmount,
    preparedCurrency: checkoutData.preparedCurrency,
    preparedResourceUrl: checkoutData.preparedResourceUrl,
    accepts: config.accepts,
  })
}

function asStoredQuote(value: unknown): StoredQuote | null {
  const terms = asQuoteTerms(value)
  if (!terms || !isRecord(value) || !allNonEmpty(value.signature)) return null
  return { ...terms, signature: value.signature as string }
}

function asQuoteTerms(value: unknown): QuoteTerms | null {
  if (!isRecord(value)) return null
  const { x402Version, preparedAmount, preparedCurrency, preparedResourceUrl, accepts } = value
  if (!isSupportedX402Version(x402Version) || !allNonEmpty(preparedAmount, preparedCurrency, preparedResourceUrl) || !Array.isArray(accepts)) return null
  const entries = accepts.filter(isQuotedRequirements)
  if (entries.length === 0 || entries.length !== accepts.length) return null
  return {
    x402Version,
    preparedAmount: preparedAmount as string,
    preparedCurrency: preparedCurrency as string,
    preparedResourceUrl: preparedResourceUrl as string,
    accepts: entries,
  }
}

function sign(terms: QuoteTerms, signingKey: string): string {
  const { x402Version, preparedAmount, preparedCurrency, preparedResourceUrl, accepts } = terms
  return createHmac("sha256", signingKey)
    .update(canonicalJson({ x402Version, preparedAmount, preparedCurrency, preparedResourceUrl, accepts }))
    .digest("hex")
}

function signatureMatches(quote: StoredQuote, signingKey: string): boolean {
  if (!signingKey) return false
  const expected = Buffer.from(sign(quote, signingKey), "utf8")
  const actual = Buffer.from(quote.signature, "utf8")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (isRecord(value)) {
    const fields = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${fields.join(",")}}`
  }
  return JSON.stringify(value)
}

function isQuotedRequirements(value: unknown): value is QuotedRequirements {
  return (
    isRecord(value) &&
    allNonEmpty(value.scheme, value.network, value.asset, value.payTo) &&
    typeof value.amount === "string" &&
    UNSIGNED_INTEGER.test(value.amount)
  )
}

function isPaymentHandlerConfig(value: unknown): value is PaymentHandlerConfig {
  return isRecord(value) && "x402Version" in value && Array.isArray(value.accepts)
}

function sameDecimal(a: unknown, b: unknown): boolean {
  if (!allNonEmpty(String(a ?? "")) || !allNonEmpty(String(b ?? ""))) return false
  const left = Number(a)
  const right = Number(b)
  return Number.isFinite(left) && Number.isFinite(right) && left === right
}

function sameCurrency(a: unknown, b: unknown): boolean {
  return allNonEmpty(a, b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

function sameAtomicValue(a: string, b: string): boolean {
  if (!UNSIGNED_INTEGER.test(a) || !UNSIGNED_INTEGER.test(b)) return false
  return BigInt(a) === BigInt(b)
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0)
}

function allNonEmpty(...values: unknown[]): boolean {
  return values.every((value) => typeof value === "string" && value.length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function fail(error: QuoteBindingError): QuoteBinding {
  return { ok: false, error }
}
