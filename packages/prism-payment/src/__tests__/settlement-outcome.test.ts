import { describe, it, expect, vi, afterEach } from "vitest"
import fixture from "../__fixtures__/settle-replies.json"
import {
  DECLINED_PREFIXES,
  DECLINED_REASONS,
  HTTP_PENDING_STATUSES,
  PENDING_REASONS,
  REVIEW_REASONS,
  classifySettleReply,
} from "../lib/settlement-outcome"
import { PrismClient, PrismHttpError, SETTLE_TIMEOUT_MS } from "../lib/prism-client"

describe("settle reply classes", () => {
  it.each(fixture.rows)("classifies $name as $first on a first attempt and $resume on a resume", (row) => {
    expect(classifySettleReply(row.http, row.body, false)).toBe(row.first)
    expect(classifySettleReply(row.http, row.body, true)).toBe(row.resume)
  })

  it("keeps the same reason lists as the shared fixture", () => {
    expect(new Set(PENDING_REASONS)).toEqual(new Set(fixture.pendingReasons))
    expect(new Set(REVIEW_REASONS)).toEqual(new Set(fixture.reviewReasons))
    expect(new Set(DECLINED_REASONS)).toEqual(new Set(fixture.declinedReasons))
    expect(new Set(DECLINED_PREFIXES)).toEqual(new Set(fixture.declinedPrefixes))
    expect(new Set(HTTP_PENDING_STATUSES)).toEqual(new Set(fixture.httpPendingStatuses))
  })

  it.each([
    ["a success with a transaction", 200, { success: true, transaction: "0x1" }, false, "settled"],
    ["a success without a transaction", 200, { success: true }, false, "pending"],
    ["an empty body", 200, null, false, "pending"],
    ["no answer", 0, null, false, "pending"],
    ["a client error", 400, null, false, "declined"],
    ["a client error on a resume", 400, null, true, "review"],
    ["a server error", 503, null, false, "pending"],
    ["a request timeout", 408, null, true, "pending"],
    ["a reason with surrounding spaces", 200, { success: false, errorReason: " quote_not_found " }, false, "declined"],
    ["a token prefix", 200, { success: false, errorReason: "unknown_token:0xabc" }, false, "declined"],
    ["a variant prefix on a resume", 200, { success: false, errorReason: "missing_variant_config:x" }, true, "review"],
    ["a success flag that is not boolean true", 200, { success: "true", transaction: "0x1" }, false, "pending"],
  ])("classifies %s", (_label, status, body, resumed, expected) => {
    expect(classifySettleReply(status as number, body, resumed as boolean)).toBe(expected)
  })
})

describe("Prism settle request", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const request = { x402Version: 2, paymentPayload: {}, paymentRequirements: {} }

  it("gives up on a settle call that never answers and the outcome counts as pending", async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal)
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
    })))
    const prism = new PrismClient({ apiUrl: "https://gw.test", apiKey: "key" })

    const settled = prism.settlePayment(request).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    expect(timeout).toHaveBeenCalledWith(SETTLE_TIMEOUT_MS)
    controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    const outcome = await settled

    expect(outcome.ok).toBe(false)
    const error = (outcome as { error: unknown }).error
    expect(error).not.toBeInstanceOf(PrismHttpError)
    expect(classifySettleReply(error instanceof PrismHttpError ? error.status : 0, null, false)).toBe("pending")
  })

  it("reports the HTTP status of a refused settle call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "slow down" }))
    const prism = new PrismClient({ apiUrl: "https://gw.test", apiKey: "key" })

    const error = await prism.settlePayment(request).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PrismHttpError)
    expect((error as PrismHttpError).status).toBe(429)
  })

  it("sets a settle timeout of 60 seconds", () => {
    expect(SETTLE_TIMEOUT_MS).toBe(60_000)
  })
})
