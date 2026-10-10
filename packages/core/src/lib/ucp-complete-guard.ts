import {
  readStoredPrismAccepts,
  validateSignedAgainstStored,
  type SignedPaymentSummary,
} from "./validate-signed-amount"

export const PRISM_UCP_HANDLER_ID = "xyz.fd.prism_payment"
export const PRISM_INSTRUMENT_TYPE = "x402"
export const PRISM_UCP_HANDLER_IDS: readonly string[] = [PRISM_UCP_HANDLER_ID, PRISM_INSTRUMENT_TYPE]

const PRISM_INSTRUMENT_TYPES: readonly unknown[] = [PRISM_INSTRUMENT_TYPE, "tokenized", "default", undefined]

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

export function normalizePrismHandlerId(handlerId: string | undefined): string | undefined {
  return handlerId === undefined || PRISM_UCP_HANDLER_IDS.includes(handlerId) ? PRISM_UCP_HANDLER_ID : handlerId
}

export function checkPrismInstrument(instrument: InstrumentInput): GuardFailure | null {
  const hasCredential = typeof instrument.credential === "object" && instrument.credential !== null
  const credentialType = hasCredential ? (instrument.credential as Record<string, unknown>).type : undefined

  if (instrument.handler_id !== undefined && !PRISM_UCP_HANDLER_IDS.includes(instrument.handler_id as string)) {
    return invalidInstrument(`handler_id must be ${PRISM_UCP_HANDLER_ID}`)
  }
  if (!PRISM_INSTRUMENT_TYPES.includes(instrument.type)) {
    return invalidInstrument(`type must be ${PRISM_INSTRUMENT_TYPE}`)
  }
  if (!hasCredential || (credentialType !== undefined && credentialType !== PRISM_INSTRUMENT_TYPE)) {
    return invalidInstrument(`credential.type must be ${PRISM_INSTRUMENT_TYPE}`)
  }
  return null
}

export function checkQuoteBinding(
  storedQuote: unknown,
  handlerId: string | undefined,
  signedSummary: SignedPaymentSummary | null,
  protocol: "ucp" | "acp" = "ucp",
): GuardFailure | null {
  if (!signedSummary) {
    return {
      status: 422,
      code: "invalid_credential",
      content: "The payment credential could not be read to check it against the cart's payment quote.",
    }
  }

  const validation = validateSignedAgainstStored(
    signedSummary,
    readStoredPrismAccepts(storedQuote, protocol === "ucp" ? normalizePrismHandlerId(handlerId) : handlerId, protocol),
  )
  return validation.ok
    ? null
    : { status: 422, code: validation.code, content: validation.message }
}

function invalidInstrument(content: string): GuardFailure {
  return { status: 422, code: "invalid_instrument", content }
}
