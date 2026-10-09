import { isPrismProvider } from "./ucp-complete-guard"
import { decimalAmount } from "./decimal-amount"

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
  storedQuote: unknown
}

export function checkoutTotalMismatch({
  paymentProviderId,
  cartTotal,
  cartCurrency,
  paymentCollectionAmount,
  storedQuote,
}: CheckoutTotals): CheckoutTotalMismatch | null {
  if (decimalAmount(cartTotal) === null) return "missing_cart_total"
  if (!sameAmount(paymentCollectionAmount, cartTotal)) return "payment_amount_mismatch"
  if (!isPrismProvider(paymentProviderId)) return null

  if (!isRecord(storedQuote) || storedQuote.preparedAmount === undefined || !isCurrencyCode(storedQuote.preparedCurrency)) {
    return "missing_payment_quote"
  }
  if (!sameAmount(storedQuote.preparedAmount, cartTotal)) return "quote_total_mismatch"
  return sameCurrency(storedQuote.preparedCurrency, cartCurrency) ? null : "quote_currency_mismatch"
}

function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function sameCurrency(a: unknown, b: unknown): boolean {
  return isCurrencyCode(a) && isCurrencyCode(b) && a.trim().toLowerCase() === b.trim().toLowerCase()
}

function sameAmount(a: unknown, b: unknown): boolean {
  const left = decimalAmount(a)
  return left !== null && left === decimalAmount(b)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
