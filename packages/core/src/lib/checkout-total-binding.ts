import { isPrismProvider } from "./ucp-complete-guard"

export const PRISM_CHECKOUT_DATA_KEY = "prism_checkout_data"

export type CheckoutTotalMismatch =
  | "missing_cart_total"
  | "payment_amount_mismatch"
  | "missing_payment_quote"
  | "quote_total_mismatch"
  | "quote_currency_mismatch"

type CheckoutTotals = {
  paymentProviderId: string
  cartTotal: unknown
  cartCurrency: unknown
  paymentCollectionAmount: unknown
  cartMetadata: unknown
}

export function checkoutTotalMismatch({
  paymentProviderId,
  cartTotal,
  cartCurrency,
  paymentCollectionAmount,
  cartMetadata,
}: CheckoutTotals): CheckoutTotalMismatch | null {
  if (amountOf(cartTotal) === null) return "missing_cart_total"
  if (!sameAmount(paymentCollectionAmount, cartTotal)) return "payment_amount_mismatch"
  if (!isPrismProvider(paymentProviderId)) return null

  const quote = isRecord(cartMetadata) ? cartMetadata[PRISM_CHECKOUT_DATA_KEY] : undefined
  if (!isRecord(quote) || quote.preparedAmount === undefined || !isCurrencyCode(quote.preparedCurrency)) {
    return "missing_payment_quote"
  }
  if (!sameAmount(quote.preparedAmount, cartTotal)) return "quote_total_mismatch"
  return sameCurrency(quote.preparedCurrency, cartCurrency) ? null : "quote_currency_mismatch"
}

function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function sameCurrency(a: unknown, b: unknown): boolean {
  return isCurrencyCode(a) && isCurrencyCode(b) && a.trim().toLowerCase() === b.trim().toLowerCase()
}

function sameAmount(a: unknown, b: unknown): boolean {
  const left = amountOf(a)
  const right = amountOf(b)
  return left !== null && right !== null && left === right
}

function amountOf(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null
  if (typeof value !== "number" && typeof value !== "string" && !isRecord(value)) return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
