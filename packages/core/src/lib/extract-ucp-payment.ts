/**
 * Extract payment authorization from UCP complete checkout request body.
 *
 * Reads from payment.instruments[0].credential per UCP spec
 * (checkout.json → payment.json → payment_instrument.json).
 */

export type ExtractedPayment = {
  eip3009Authorization: string
  x402Version?: number
  handlerId?: string
}

export function extractUcpPayment(body: Record<string, unknown>): ExtractedPayment | null {
  const payment = body?.payment as { instruments?: Record<string, unknown>[] } | undefined
  const instrument = payment?.instruments?.[0]
  if (!instrument) return null

  const credential = instrument.credential as Record<string, unknown> | undefined
  if (!credential) return null

  // Direct authorization field
  let authorization = credential.authorization as string | undefined
  let x402Version = credential.x402_version as number | undefined

  // Full x402 paymentPayload structure — base64-encode the entire credential
  if (!authorization && credential.paymentPayload) {
    authorization = Buffer.from(JSON.stringify(credential)).toString("base64")
    x402Version = (credential.x402Version ?? credential.x402_version ?? 2) as number
  }

  if (!authorization) return null

  return {
    eip3009Authorization: authorization,
    x402Version,
    handlerId: instrument.handler_id as string | undefined,
  }
}
