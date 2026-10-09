import { quoteSignatureFor, storedQuoteFromCheckoutData } from "../../lib/quote-binding"

export const NETWORK = "eip155:84532"
export const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
export const MERCHANT = "0x1111111111111111111111111111111111111111"
export const QUOTED_VALUE = "1500000"
export const CART_TOTAL = 15
export const NONCE = `0x${"ab".repeat(32)}`

export const quotedEntry = {
  scheme: "exact",
  network: NETWORK,
  amount: QUOTED_VALUE,
  asset: ASSET,
  payTo: MERCHANT,
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
}

export const QUOTE_SIGNING_KEY = "key"

export function unsignedCheckoutData(accepts: Record<string, unknown>[] = [quotedEntry]) {
  return {
    ucp: { "xyz.fd.prism_payment": [{ id: "xyz.fd.prism_payment", version: "2026-04-08", config: { x402Version: 2, resource: { url: "https://shop.test/ucp/checkout-sessions/cart_1" }, accepts } }] },
    acp: null,
    preparedAmount: String(CART_TOTAL),
    preparedResourceUrl: "https://shop.test/ucp/checkout-sessions/cart_1",
  }
}

export function signedCheckoutData(signingKey: string = QUOTE_SIGNING_KEY, accepts?: Record<string, unknown>[]) {
  const unsigned = unsignedCheckoutData(accepts)
  return { ...unsigned, quoteSignature: quoteSignatureFor(unsigned, signingKey) }
}

export const checkoutData = signedCheckoutData()

export type Overrides = {
  value?: string
  to?: string
  network?: string
  asset?: string
  validAfter?: string
  validBefore?: string | undefined
  nonce?: string | undefined
}

export function credential(overrides: Overrides = {}) {
  const inOneHour = String(Math.floor(Date.now() / 1000) + 3600)
  const authorization: Record<string, unknown> = {
    from: "0x2222222222222222222222222222222222222222",
    to: overrides.to ?? MERCHANT,
    value: overrides.value ?? QUOTED_VALUE,
    validAfter: overrides.validAfter ?? "0",
    validBefore: "validBefore" in overrides ? overrides.validBefore : inOneHour,
    nonce: "nonce" in overrides ? overrides.nonce : NONCE,
  }
  for (const key of Object.keys(authorization)) {
    if (authorization[key] === undefined) delete authorization[key]
  }
  const accepted = {
    ...quotedEntry,
    network: overrides.network ?? NETWORK,
    asset: overrides.asset ?? ASSET,
    amount: overrides.value ?? QUOTED_VALUE,
    payTo: overrides.to ?? MERCHANT,
  }
  return {
    x402Version: 2,
    paymentPayload: { x402Version: 2, accepted, payload: { signature: "0xsig", authorization } },
    paymentRequirements: { ...accepted, amount: "1" },
  }
}

export const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64")

export function quotedSession(): Record<string, unknown> {
  return { payment_quote: storedQuoteFromCheckoutData(checkoutData), amount: CART_TOTAL }
}
