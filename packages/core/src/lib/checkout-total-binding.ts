import { isPrismProvider } from "./ucp-complete-guard"

export const PRISM_CHECKOUT_DATA_KEY = "prism_checkout_data"

export type CheckoutTotalMismatch =
  | "payment_amount_mismatch"
  | "missing_payment_quote"
  | "quote_total_mismatch"

type CheckoutTotals = {
  paymentProviderId: string
  cartTotal: unknown
  paymentCollectionAmount: unknown
  cartMetadata: unknown
}

export function checkoutTotalMismatch({
  paymentProviderId,
  cartTotal,
  paymentCollectionAmount,
  cartMetadata,
}: CheckoutTotals): CheckoutTotalMismatch | null {
  if (!sameAmount(paymentCollectionAmount, cartTotal)) return "payment_amount_mismatch"
  if (!isPrismProvider(paymentProviderId)) return null

  const preparedAmount = preparedAmountOf(cartMetadata)
  if (preparedAmount === undefined) return "missing_payment_quote"
  return sameAmount(preparedAmount, cartTotal) ? null : "quote_total_mismatch"
}

function preparedAmountOf(cartMetadata: unknown): unknown {
  if (!isRecord(cartMetadata)) return undefined
  const checkoutData = cartMetadata[PRISM_CHECKOUT_DATA_KEY]
  return isRecord(checkoutData) ? checkoutData.preparedAmount : undefined
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
