import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import PrismPaymentProviderService, { CREDENTIAL_HANDOFF_MISMATCH, CREDENTIAL_HANDOFF_MISSING } from "../modules/prism-payment/service"
import { PrismHttpError } from "../lib/prism-client"
import { credentialSha256, currentCredentialHandoff } from "../lib/credential-handoff"
import { settledPaymentMismatch } from "../lib/quote-binding"
import settleFixture from "../__fixtures__/settle-replies.json"
import { Redacted, markSettlementResume, withCredentialHandoff } from "../../../core/src/lib/credential-handoff"
import { authorizeWithHandoff, inHandoff } from "./helpers/credential-handoff"
import {
  ASSET,
  CART_TOTAL,
  NETWORK,
  NONCE,
  QUOTED_VALUE,
  QUOTE_SIGNING_KEY,
  checkoutData,
  credential,
  encode,
  quotedSession,
} from "./helpers/quoted-payment"

const SESSION_KEYS = [
  "prism_session_id",
  "amount",
  "currency_code",
  "supported_assets",
  "supported_chains",
  "ucp_version",
  "x402_version",
  "instrument_type",
  "credential_sha256",
  "payment_quote",
  "settlement_state",
  "error",
  "error_message",
  "unreconciled_transaction",
  "prism_tx_id",
  "transaction_reference",
  "transaction_network",
  "network",
  "settled_amount",
  "settled_asset",
  "payer",
  "signed_value",
  "captured",
  "eip3009_authorization",
  "x402_authorization",
  "settlement_resume",
  "verified",
].sort()

const ALWAYS_NULL = ["eip3009_authorization", "x402_authorization", "settlement_resume", "verified"]

const SIGNATURE = `0x${"c7".repeat(65)}`

function canaryCredential(overrides: Parameters<typeof credential>[0] = {}) {
  const cred = credential(overrides)
  ;(cred.paymentPayload.payload as Record<string, unknown>).signature = SIGNATURE
  return encode(cred)
}

function expectNoCredential(output: unknown, handed: string) {
  const data = output as Record<string, unknown>
  expect(Object.keys(data).sort()).toEqual(SESSION_KEYS)
  for (const key of ALWAYS_NULL) expect(data[key], key).toBeNull()
  const serialized = JSON.stringify(data)
  expect(serialized).not.toContain(handed)
  expect(serialized).not.toContain(SIGNATURE)
  expect(serialized.toLowerCase()).not.toContain(NONCE.toLowerCase())
}

function makeProvider(options: Record<string, unknown> = {}) {
  const provider = new PrismPaymentProviderService({}, { api_url: "https://gw.test", api_key: "key", ...options } as never)
  const client = {
    verifyPayment: vi.fn().mockResolvedValue({ isValid: true }),
    settlePayment: vi.fn().mockResolvedValue({ success: true, transaction: "0xtx", network: NETWORK }),
    getApiKey: () => QUOTE_SIGNING_KEY,
  }
  ;(provider as unknown as { client: typeof client }).client = client
  return { provider, client }
}

const forgedSettlement = {
  prism_tx_id: "0xforged",
  transaction_reference: "0xforged",
  transaction_network: NETWORK,
  settled_asset: ASSET,
  settled_amount: QUOTED_VALUE,
  payer: "0x2222222222222222222222222222222222222222",
  captured: true,
  verified: true,
  settlement_resume: true,
}

describe("Prism provider authorizes only with the credential handed over in memory", () => {
  let provider: PrismPaymentProviderService
  let client: ReturnType<typeof makeProvider>["client"]

  beforeEach(() => {
    ;({ provider, client } = makeProvider())
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function shopperSession(clientData: Record<string, unknown>) {
    const initiated = await provider.initiatePayment({ amount: CART_TOTAL, currency_code: "usd", data: clientData } as never)
    return { ...clientData, ...(initiated.data as Record<string, unknown>) }
  }

  it("declines a shopper session that forges a settlement next to a valid signed quote", async () => {
    const forged = { ...quotedSession(), ...forgedSettlement, transaction_reference: "0xforged" }
    expect(settledPaymentMismatch(forged, QUOTE_SIGNING_KEY)).toBeNull()

    const result = await provider.authorizePayment({ data: forged } as never)

    expect(result.status).toBe("error")
    expect(result.data).toMatchObject({ error: CREDENTIAL_HANDOFF_MISSING, settlement_state: "declined", prism_tx_id: null, captured: null })
    expect(client.verifyPayment).not.toHaveBeenCalled()
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("drops every settlement fact a shopper writes when creating a payment session", async () => {
    const stored = await shopperSession({ prism_checkout_data: checkoutData, ...forgedSettlement, eip3009_authorization: canaryCredential() })

    for (const key of ["prism_tx_id", "transaction_reference", "transaction_network", "settled_asset", "settled_amount", "payer", "captured", "verified", "settlement_resume", "eip3009_authorization"]) {
      expect(stored[key], key).toBeNull()
    }
    expect((await provider.getPaymentStatus({ data: stored } as never)).status).toBe("pending")
    await expect(provider.capturePayment({ data: stored } as never)).rejects.toThrow("missing_payment_authorization")
    const result = await provider.authorizePayment({ data: stored } as never)
    expect(result.data).toMatchObject({ error: CREDENTIAL_HANDOFF_MISSING })
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("declines a credential kept in session data when nothing was handed over", async () => {
    const handed = canaryCredential()
    const data = { ...quotedSession(), credential_sha256: credentialSha256(handed), eip3009_authorization: handed, x402_authorization: handed }

    const result = await provider.authorizePayment({ data } as never)

    expect(result.status).toBe("error")
    expect(result.data).toMatchObject({ error: CREDENTIAL_HANDOFF_MISSING, settlement_state: "declined" })
    expectNoCredential(result.data, handed)
    expect(client.verifyPayment).not.toHaveBeenCalled()
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("declines a handed credential whose digest differs from the session", async () => {
    const handed = canaryCredential()
    const other = canaryCredential({ value: "1" })
    const data = { ...quotedSession(), credential_sha256: credentialSha256(other) }

    const result = await inHandoff(handed, () => provider.authorizePayment({ data } as never))

    expect(result.data).toMatchObject({ error: CREDENTIAL_HANDOFF_MISMATCH, settlement_state: "declined" })
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("declines a session that names no credential digest even when a credential is handed over", async () => {
    const handed = canaryCredential()

    const result = await inHandoff(handed, () => provider.authorizePayment({ data: quotedSession() } as never))

    expect(result.data).toMatchObject({ error: CREDENTIAL_HANDOFF_MISMATCH })
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("does not accept a recorded settlement under a handoff for another credential", async () => {
    const handed = canaryCredential()
    const forged = { ...quotedSession(), ...forgedSettlement, credential_sha256: credentialSha256("someone else") }

    const result = await inHandoff(handed, () => provider.authorizePayment({ data: forged } as never))

    expect(result.status).toBe("error")
    expect(result.data).toMatchObject({ error: CREDENTIAL_HANDOFF_MISMATCH })
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("takes the resume decision from the handoff, never from the session data", async () => {
    const handed = canaryCredential()
    const data = { ...quotedSession(), credential_sha256: credentialSha256(handed), settlement_resume: true }

    await inHandoff(handed, () => provider.authorizePayment({ data } as never))
    expect(client.verifyPayment).toHaveBeenCalledTimes(1)

    client.verifyPayment.mockClear()
    await inHandoff(handed, () => provider.authorizePayment({ data: { ...data, settlement_resume: false } } as never), true)
    expect(client.verifyPayment).not.toHaveBeenCalled()
  })

  it("reads the credential and the resume decision the core plugin hands over", async () => {
    const handed = canaryCredential()

    const seen = await withCredentialHandoff(new Redacted(handed), async () => {
      const before = currentCredentialHandoff()
      markSettlementResume(true)
      return { before, after: currentCredentialHandoff() }
    })

    expect(seen.before).toEqual({ credential: handed, settlementResume: false })
    expect(seen.after).toEqual({ credential: handed, settlementResume: true })
    expect(currentCredentialHandoff()).toBeNull()
  })
})

describe("Prism payment session data never holds a credential", () => {
  let provider: PrismPaymentProviderService
  let client: ReturnType<typeof makeProvider>["client"]

  beforeEach(() => {
    ;({ provider, client } = makeProvider())
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function initiated(handed: string, extra: Record<string, unknown> = {}) {
    const result = await provider.initiatePayment({
      amount: CART_TOTAL,
      currency_code: "usd",
      data: { x402_version: 2, prism_checkout_data: checkoutData, credential_sha256: credentialSha256(handed), eip3009_authorization: handed, x402_authorization: handed, ...extra },
    } as never)
    return result.data as Record<string, unknown>
  }

  const authorize = async (handed: string, data: Record<string, unknown>, resume = false) =>
    inHandoff(handed, () => provider.authorizePayment({ data } as never), resume)

  it("returns only the known keys and no credential from initiate and update", async () => {
    const handed = canaryCredential()
    const data = await initiated(handed)
    expectNoCredential(data, handed)

    const updated = await provider.updatePayment({ amount: CART_TOTAL, currency_code: "usd", data: { ...data, eip3009_authorization: handed } } as never)
    expectNoCredential(updated.data, handed)
  })

  it("returns no credential for a settled outcome, its capture and a repeated authorization", async () => {
    const handed = canaryCredential()
    const result = await authorize(handed, await initiated(handed))
    expect(result.status).toBe("authorized")
    expect(result.data).toMatchObject({ settlement_state: "settled", prism_tx_id: "0xtx", settled_amount: QUOTED_VALUE, settled_asset: ASSET })
    expectNoCredential(result.data, handed)

    const captured = await provider.capturePayment({ data: result.data } as never)
    expect(captured.data).toMatchObject({ captured: true, prism_tx_id: "0xtx" })
    expectNoCredential(captured.data, handed)

    const again = await authorize(handed, result.data as Record<string, unknown>)
    expect(again.data).toMatchObject({ settlement_state: "review" })
    expectNoCredential(again.data, handed)

    const tampered = await authorize(handed, { ...(result.data as Record<string, unknown>), settled_amount: "1" })
    expect(tampered.data).toMatchObject({ settlement_state: "review" })
    expectNoCredential(tampered.data, handed)
  })

  it.each(settleFixture.rows.filter((row) => row.http === 200).flatMap((row) => [
    [`${row.name} on a first attempt`, row.body, false],
    [`${row.name} on a resume`, row.body, true],
  ] as const))("returns no credential for the settle reply %s", async (_label, body, resume) => {
    client.settlePayment.mockResolvedValue(body)
    const handed = canaryCredential()

    const result = await authorize(handed, await initiated(handed), resume)

    expect(result.status).toBe("error")
    expectNoCredential(result.data, handed)
  })

  it.each([
    ["a conflict answer", new PrismHttpError(409, "conflict")],
    ["a refused request", new PrismHttpError(400, "bad request")],
    ["a network failure", new Error("socket hang up")],
  ])("returns no credential when the settle call ends with %s", async (_label, error) => {
    client.settlePayment.mockRejectedValue(error)
    const handed = canaryCredential()

    const result = await authorize(handed, await initiated(handed))

    expectNoCredential(result.data, handed)
  })

  it("returns no credential when the settled reply does not match the quote", async () => {
    client.settlePayment.mockResolvedValue({ success: true, transaction: "0xmoved", network: "eip155:1" })
    const handed = canaryCredential()

    const result = await authorize(handed, await initiated(handed))

    expect(result.data).toMatchObject({ settlement_state: "review", unreconciled_transaction: "0xmoved" })
    expectNoCredential(result.data, handed)
  })

  it.each([
    ["verification says invalid", (mock: typeof client) => mock.verifyPayment.mockResolvedValue({ isValid: false, error: "bad" })],
    ["verification fails", (mock: typeof client) => mock.verifyPayment.mockRejectedValue(new Error("timeout"))],
  ])("returns no credential when %s", async (_label, arrange) => {
    arrange(client)
    const handed = canaryCredential()

    const result = await authorize(handed, await initiated(handed))

    expect(result.data).toMatchObject({ settlement_state: "declined" })
    expectNoCredential(result.data, handed)
  })

  it.each([
    ["the credential cannot be decoded", () => "%%%not-base64-json", {}],
    ["the instrument type is not x402", () => canaryCredential(), { instrument_type: "card" }],
    ["the credential has no EIP-3009 fields", () => encode({ x402Version: 2, paymentPayload: { payload: { signature: SIGNATURE } } }), {}],
    ["the signed amount does not match the quote", () => canaryCredential({ value: "1" }), {}],
    ["the signed authorization expired", () => canaryCredential({ validBefore: "1" }), {}],
  ])("returns no credential when %s", async (_label, make, extra) => {
    const handed = make()

    const result = await authorize(handed, await initiated(handed, extra))

    expect(result.status).toBe("error")
    expect(result.data).toMatchObject({ settlement_state: "declined" })
    expectNoCredential(result.data, handed)
    expect(client.settlePayment).not.toHaveBeenCalled()
  })

  it("returns no credential when the handoff is missing or names another credential", async () => {
    const handed = canaryCredential()
    const data = await initiated(handed)

    expectNoCredential((await provider.authorizePayment({ data } as never)).data, handed)
    expectNoCredential((await authorize(canaryCredential({ value: "2" }), data)).data, handed)
  })

  it("keeps the authorize path free of credential logs", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    client.verifyPayment.mockRejectedValue(new Error("timeout"))
    const handed = canaryCredential()

    await authorize(handed, await initiated(handed))
    await authorize("%%%not-base64-json", await initiated("%%%not-base64-json"))

    const logged = JSON.stringify([...errors.mock.calls, ...warnings.mock.calls])
    expect(logged).not.toContain(handed)
    expect(logged).not.toContain(SIGNATURE)
    expect(logged).not.toContain("not-base64-json")
  })

  it.each([
    ["a settle reply reason", (mock: typeof client) => mock.settlePayment.mockResolvedValue({ success: false, errorReason: `invalid_signature ${SIGNATURE}` })],
    ["a settle error message", (mock: typeof client) => mock.settlePayment.mockRejectedValue(new Error(`rejected ${SIGNATURE}`))],
    ["a verify reason", (mock: typeof client) => mock.verifyPayment.mockResolvedValue({ isValid: false, error: `bad ${SIGNATURE}` })],
    ["a verify error message", (mock: typeof client) => mock.verifyPayment.mockRejectedValue(new Error(`bad ${SIGNATURE}`))],
  ])("does not store or log %s that echoes the signed credential", async (_label, arrange) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
    arrange(client)
    const handed = canaryCredential()

    const result = await authorize(handed, await initiated(handed))

    expect(String((result.data as Record<string, unknown>).error)).toContain("unreadable_reason")
    expectNoCredential(result.data, handed)
    expect(JSON.stringify(errors.mock.calls)).not.toContain(SIGNATURE)
  })

  it("leaves no credential in the output when the shared test helper hands it over", async () => {
    const handed = canaryCredential()
    const result = await authorizeWithHandoff(provider, { data: { ...(await initiated(handed)), eip3009_authorization: handed } })

    expect(result.status).toBe("authorized")
    expectNoCredential(result.data, handed)
  })
})
