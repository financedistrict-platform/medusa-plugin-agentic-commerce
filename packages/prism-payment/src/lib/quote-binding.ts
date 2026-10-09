import { createHmac, timingSafeEqual } from "node:crypto"
import type { PaymentHandlerConfig, X402AcceptEntry } from "./prism-client"
import type { X402PaymentAuthorization } from "../modules/prism-payment/types"

export type QuotedRequirements = X402AcceptEntry & { amount: string }

type QuoteTerms = {
  x402Version: number
  preparedAmount: string
  preparedCurrency: string
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
  | "amount_mismatch"
  | "wrong_recipient"
  | "authorization_expired"
  | "authorization_not_yet_valid"
  | "invalid_nonce"

export type QuoteBinding =
  | { ok: true; x402Version: number; requirements: QuotedRequirements }
  | { ok: false; error: QuoteBindingError }

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/
const UNSIGNED_INTEGER = /^\d+$/

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
): QuoteBinding {
  const quote = asStoredQuote(storedQuote)
  if (!quote) return fail("missing_payment_quote")
  if (!signatureMatches(quote, signingKey)) return fail("invalid_quote_signature")
  if (!sameDecimal(quote.preparedAmount, sessionAmount)) return fail("quote_total_mismatch")
  if (!sameCurrency(quote.preparedCurrency, sessionCurrency)) return fail("quote_currency_mismatch")

  const signed = authorization.paymentPayload?.payload?.authorization
  if (!signed || !allNonEmpty(signed.from, signed.to, signed.value, signed.validAfter, signed.validBefore, signed.nonce)) {
    return fail("missing_eip3009_fields")
  }

  const requirements = quotedEntryFor(authorization, quote)
  if (!requirements) return fail("no_matching_quote_entry")
  if (!sameAtomicValue(requirements.amount, signed.value)) return fail("amount_mismatch")
  if (!sameAddress(requirements.payTo, signed.to)) return fail("wrong_recipient")
  if (!UNSIGNED_INTEGER.test(signed.validBefore) || Number(signed.validBefore) <= nowSeconds) return fail("authorization_expired")
  if (!UNSIGNED_INTEGER.test(signed.validAfter) || Number(signed.validAfter) > nowSeconds) return fail("authorization_not_yet_valid")
  if (!BYTES32_HEX.test(signed.nonce)) return fail("invalid_nonce")

  return { ok: true, x402Version: quote.x402Version, requirements }
}

function quotedEntryFor(authorization: X402PaymentAuthorization, quote: StoredQuote): QuotedRequirements | null {
  const payload = authorization.paymentPayload as unknown as Record<string, unknown>
  const accepted = isRecord(payload.accepted) ? payload.accepted : {}
  const buyerRequirements = isRecord(authorization.paymentRequirements) ? authorization.paymentRequirements : {}
  const network = firstString(accepted.network, payload.network)
  const asset = firstString(accepted.asset, buyerRequirements.asset)
  if (!network || !asset) return null
  return quote.accepts.find((entry) => entry.network === network && sameAddress(entry.asset, asset)) ?? null
}

function quoteTermsFromCheckoutData(checkoutData: unknown): QuoteTerms | null {
  const config = paymentConfigFromCheckoutData(checkoutData)
  if (!config || !isRecord(checkoutData)) return null
  return asQuoteTerms({
    x402Version: config.x402Version,
    preparedAmount: checkoutData.preparedAmount,
    preparedCurrency: checkoutData.preparedCurrency,
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
  const { x402Version, preparedAmount, preparedCurrency, accepts } = value
  if (typeof x402Version !== "number" || !allNonEmpty(preparedAmount, preparedCurrency) || !Array.isArray(accepts)) return null
  const entries = accepts.filter(isQuotedRequirements)
  if (entries.length === 0 || entries.length !== accepts.length) return null
  return { x402Version, preparedAmount: preparedAmount as string, preparedCurrency: preparedCurrency as string, accepts: entries }
}

function sign(terms: QuoteTerms, signingKey: string): string {
  const { x402Version, preparedAmount, preparedCurrency, accepts } = terms
  return createHmac("sha256", signingKey).update(canonicalJson({ x402Version, preparedAmount, preparedCurrency, accepts })).digest("hex")
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
