import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"
import { isContractEntry } from "../lib/prism-client"

const HANDLER_ID = "xyz.fd.prism_payment"

const contractResponse = {
  [HANDLER_ID]: [{
    id: HANDLER_ID,
    version: "2026-10-07",
    spec: "https://gw.test/ucp/prism.md",
    schema: "https://gw.test/ucp/schema.json",
    available_instruments: [{ type: "x402" }],
    config: {},
  }],
}

describe("isContractEntry", () => {
  it("accepts the contract entry", () => {
    expect(isContractEntry(contractResponse)).toBe(true)
  })

  it.each([
    ["an empty response", {}],
    ["a null response", null],
    ["an empty entry list", { [HANDLER_ID]: [] }],
    ["a legacy id", { [HANDLER_ID]: [{ ...contractResponse[HANDLER_ID][0], id: "x402" }] }],
    ["a missing schema", { [HANDLER_ID]: [{ ...contractResponse[HANDLER_ID][0], schema: undefined }] }],
    ["an empty version", { [HANDLER_ID]: [{ ...contractResponse[HANDLER_ID][0], version: "" }] }],
    ["a missing spec", { [HANDLER_ID]: [{ ...contractResponse[HANDLER_ID][0], spec: undefined }] }],
  ])("rejects %s", (_label, data) => {
    expect(isContractEntry(data)).toBe(false)
  })
})

describe("PrismPaymentHandlerAdapter UCP discovery guard", () => {
  let adapter: PrismPaymentHandlerAdapter
  let fetchUcpHandlers: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    adapter = new PrismPaymentHandlerAdapter({}, {})
    fetchUcpHandlers = vi.fn()
    ;(adapter as any).client = { fetchUcpHandlers }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("serves and caches a valid entry", async () => {
    fetchUcpHandlers.mockResolvedValue(contractResponse)
    expect(await adapter.getUcpDiscoveryHandlers()).toEqual(contractResponse)
    expect(await adapter.getUcpDiscoveryHandlers()).toEqual(contractResponse)
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(1)
  })

  it("omits an invalid entry, logs it, and does not cache it", async () => {
    fetchUcpHandlers.mockResolvedValue({ [HANDLER_ID]: [{ id: HANDLER_ID, version: "2026-10-07" }] })
    expect(await adapter.getUcpDiscoveryHandlers()).toEqual({})
    expect(console.error).toHaveBeenCalledTimes(1)

    fetchUcpHandlers.mockResolvedValue(contractResponse)
    expect(await adapter.getUcpDiscoveryHandlers()).toEqual({})
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(61_000)
    expect(await adapter.getUcpDiscoveryHandlers()).toEqual(contractResponse)
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(2)
  })

  it("drops the expired cache when Prism is unreachable", async () => {
    fetchUcpHandlers.mockResolvedValue(contractResponse)
    await adapter.getUcpDiscoveryHandlers()

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    fetchUcpHandlers.mockRejectedValue(new Error("ECONNREFUSED"))
    expect(await adapter.getUcpDiscoveryHandlers()).toEqual({})
    expect(await adapter.getUcpDiscoveryHandlers()).toEqual({})
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(2)
  })
})
