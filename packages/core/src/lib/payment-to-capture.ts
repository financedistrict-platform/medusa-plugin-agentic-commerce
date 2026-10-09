type CapturablePayment = {
  id?: string
  provider_id?: string
  captured_at?: unknown
  canceled_at?: unknown
}

type CartPaymentsQuery = {
  data?: Array<{ payment_collection?: { payments?: Array<CapturablePayment | null> | null } | null } | null>
}

export function paymentToCapture(query: CartPaymentsQuery, providerId: string): string | null {
  const payments = query.data?.[0]?.payment_collection?.payments ?? []
  const open = payments.find(
    (payment) =>
      !!payment?.id &&
      payment.provider_id === providerId &&
      !payment.captured_at &&
      !payment.canceled_at,
  )
  return open?.id ?? null
}
