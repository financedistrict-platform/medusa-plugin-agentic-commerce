import { decimalAmount } from "./decimal-amount"

type PaymentSessionLike = { status?: unknown; data?: Record<string, unknown> | null }

type CompletedCart = {
  metadata?: Record<string, unknown> | null
  total?: unknown
  currency_code?: unknown
  payment_collection?: { payment_sessions?: Array<PaymentSessionLike | null> | null } | null
}

type CartWriter = { updateCarts(id: string, data: { metadata: Record<string, unknown> }): Promise<unknown> }

type Resolver = { resolve(name: string): unknown }

export function settledSessionData(cart: CompletedCart | null | undefined): Record<string, any> {
  const sessions = (cart?.payment_collection?.payment_sessions ?? []).filter((session): session is PaymentSessionLike => !!session)
  const active = sessions.find((session) => session.status === "authorized" || session.status === "captured") ?? sessions[0]
  return active?.data ?? {}
}

export function settledPaymentMetadata(cart: CompletedCart, paymentMethod: string): Record<string, string | null> {
  const data = settledSessionData(cart)
  const transaction = text(data.prism_tx_id) ?? text(data.transaction_reference)
  const settledValue = text(data.settled_amount)
  const total = decimalAmount(cart.total)
  const settled = transaction !== null && settledValue !== null && total !== null

  return {
    payment_method: paymentMethod,
    payment_amount: settled ? total : null,
    payment_currency: text(cart.currency_code),
    payment_settled_value: settledValue,
    payment_settled_asset: text(data.settled_asset),
    payment_settled_network: text(data.transaction_network),
    payment_transaction: transaction,
  }
}

export async function recordSettledPayment<T extends CompletedCart>(
  scope: Resolver,
  cartId: string,
  cart: T,
  paymentMethod: string,
): Promise<T> {
  const metadata = {
    ...cart.metadata,
    ...settledPaymentMetadata(cart, paymentMethod),
    checkout_session_completed_at: new Date().toISOString(),
  }
  try {
    await (scope.resolve("cart") as CartWriter).updateCarts(cartId, { metadata })
  } catch (error: unknown) {
    console.error(`[agentic-commerce] Could not record the settled payment on cart ${cartId}: ${error instanceof Error ? error.message : String(error)}`)
    return cart
  }
  return { ...cart, metadata }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
