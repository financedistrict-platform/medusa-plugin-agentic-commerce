import {
  extractSignedSummary,
  readStoredPrismAccepts,
  validateSignedAgainstStored,
} from "./validate-signed-amount"

export const PRISM_UCP_HANDLER_ID = "xyz.fd.prism_payment"
export const PRISM_INSTRUMENT_TYPE = "x402"

const PRISM_PROVIDER_PREFIX = "pp_prism_"

export type GuardFailure = {
  status: 400 | 422
  code: string
  content: string
}

type InstrumentInput = {
  handler_id?: unknown
  type?: unknown
  credential?: unknown
}

export function isPrismProvider(paymentProviderId: string): boolean {
  return paymentProviderId.startsWith(PRISM_PROVIDER_PREFIX)
}

export function formatZodIssuePath(issues: { path: PropertyKey[] }[]): string {
  const path = issues[0]?.path ?? []
  return path.length > 0 ? path.map(String).join(".") : "body"
}

export function checkPrismInstrument(instrument: InstrumentInput): GuardFailure | null {
  const credentialType = typeof instrument.credential === "object" && instrument.credential !== null
    ? (instrument.credential as Record<string, unknown>).type
    : undefined

  if (instrument.handler_id !== PRISM_UCP_HANDLER_ID) {
    return invalidInstrument(`handler_id must be ${PRISM_UCP_HANDLER_ID}`)
  }
  if (instrument.type !== PRISM_INSTRUMENT_TYPE) {
    return invalidInstrument(`type must be ${PRISM_INSTRUMENT_TYPE}`)
  }
  if (credentialType !== PRISM_INSTRUMENT_TYPE) {
    return invalidInstrument(`credential.type must be ${PRISM_INSTRUMENT_TYPE}`)
  }
  return null
}

export function checkQuoteBinding(
  cartMetadata: unknown,
  handlerId: string | undefined,
  credential: unknown,
): GuardFailure | null {
  if (!hasPrismQuote(cartMetadata)) return null

  const signedSummary = extractSignedSummary(credential)
  if (!signedSummary) {
    return {
      status: 422,
      code: "invalid_credential",
      content: "The payment credential could not be read to check it against the cart's payment quote.",
    }
  }

  const validation = validateSignedAgainstStored(
    signedSummary,
    readStoredPrismAccepts(cartMetadata, handlerId, "ucp"),
  )
  return validation.ok
    ? null
    : { status: 422, code: validation.code, content: validation.message }
}

function hasPrismQuote(cartMetadata: unknown): boolean {
  if (typeof cartMetadata !== "object" || cartMetadata === null) return false
  const data = (cartMetadata as Record<string, unknown>).prism_checkout_data
  return typeof data === "object" && data !== null
}

function invalidInstrument(content: string): GuardFailure {
  return { status: 422, code: "invalid_instrument", content }
}
