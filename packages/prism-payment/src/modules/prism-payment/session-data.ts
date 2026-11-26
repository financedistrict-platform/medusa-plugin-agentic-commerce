import { asStoredQuote, type StoredQuote } from "../../lib/quote-binding"
import type { SettlementState } from "../../lib/settlement-outcome"
import type { SettledPayment } from "./types"

export type PrismSessionBase = {
  prism_session_id: string | null
  amount: unknown
  currency_code: unknown
  supported_assets: string[]
  supported_chains: string[] | null
  ucp_version: string | null
  x402_version: number | null
  instrument_type: string | null
  credential_sha256: string | null
  payment_quote: StoredQuote | null
}

export type PrismSessionOutcome = {
  settlement_state: SettlementState | null
  error: string | null
  error_message: string | null
  unreconciled_transaction: string | null
  prism_tx_id: string | null
  transaction_reference: string | null
  transaction_network: string | null
  network: string | null
  settled_amount: string | null
  settled_asset: string | null
  payer: string | null
  signed_value: string | null
  captured: boolean | null
}

type ClientOnlyKeys = {
  eip3009_authorization: null
  x402_authorization: null
  settlement_resume: null
  verified: null
}

export type PrismSessionData = PrismSessionBase & PrismSessionOutcome & ClientOnlyKeys

const NO_OUTCOME: PrismSessionOutcome = {
  settlement_state: null,
  error: null,
  error_message: null,
  unreconciled_transaction: null,
  prism_tx_id: null,
  transaction_reference: null,
  transaction_network: null,
  network: null,
  settled_amount: null,
  settled_asset: null,
  payer: null,
  signed_value: null,
  captured: null,
}

const NO_CLIENT_KEYS: ClientOnlyKeys = {
  eip3009_authorization: null,
  x402_authorization: null,
  settlement_resume: null,
  verified: null,
}

export function prismSessionData(base: PrismSessionBase, outcome: Partial<PrismSessionOutcome> = {}): PrismSessionData {
  return { ...base, ...NO_OUTCOME, ...outcome, ...NO_CLIENT_KEYS }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export type SessionDefaults = { supportedAssets: string[]; supportedChains: string[] | undefined }

export function sessionBaseOf(data: Record<string, unknown>, defaults: SessionDefaults): PrismSessionBase {
  return {
    prism_session_id: text(data.prism_session_id),
    amount: data.amount,
    currency_code: data.currency_code,
    supported_assets: defaults.supportedAssets,
    supported_chains: defaults.supportedChains ?? null,
    ucp_version: text(data.ucp_version),
    x402_version: typeof data.x402_version === "number" ? data.x402_version : null,
    instrument_type: text(data.instrument_type),
    credential_sha256: text(data.credential_sha256),
    payment_quote: asStoredQuote(data.payment_quote),
  }
}

export function settledOutcome(settled: SettledPayment): Partial<PrismSessionOutcome> {
  return {
    settlement_state: "settled",
    transaction_reference: settled.transaction,
    transaction_network: settled.network,
    prism_tx_id: settled.transaction,
    settled_amount: settled.amount,
    settled_asset: settled.asset,
  }
}

export function recordedSettlement(data: Record<string, unknown>): Partial<PrismSessionOutcome> {
  return {
    settlement_state: "settled",
    prism_tx_id: text(data.prism_tx_id),
    transaction_reference: text(data.transaction_reference),
    transaction_network: text(data.transaction_network),
    network: text(data.network),
    settled_amount: text(data.settled_amount),
    settled_asset: text(data.settled_asset),
    payer: text(data.payer),
    signed_value: text(data.signed_value),
  }
}
