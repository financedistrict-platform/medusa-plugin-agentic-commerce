import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"
import { PrismClient, isContractEntry, normalizeUcpHandlers } from "../lib/prism-client"
import { readPackageVersion } from "../lib/package-version"

const HANDLER_ID = "xyz.fd.prism_payment"
const PRISM_FIXTURES = join(__dirname, "..", "..", "..", "core", "src", "__fixtures__", "prism")

const recorded = (name: string) => JSON.parse(readFileSync(join(PRISM_FIXTURES, name), "utf8"))

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

  it("accepts the legacy entry served by prod Prism", () => {
    expect(isContractEntry(recorded("legacy-handlers.json"))).toBe(true)
  })

  it("accepts an entry without available_instruments", () => {
    const { available_instruments: _omit, ...entry } = contractResponse[HANDLER_ID][0]
    expect(isContractEntry({ [HANDLER_ID]: [entry] })).toBe(true)
  })

  it.each([
    ["an empty response", {}],
    ["a null response", null],
    ["an empty entry list", { [HANDLER_ID]: [] }],
    ["a foreign id", { [HANDLER_ID]: [{ ...contractResponse[HANDLER_ID][0], id: "com.other.pay" }] }],
    ["a missing schema", { [HANDLER_ID]: [{ ...contractResponse[HANDLER_ID][0], schema: undefined }] }],
    ["an empty version", { [HANDLER_ID]: [{ ...contractResponse[HANDLER_ID][0], version: "" }] }],
    ["a missing spec", { [HANDLER_ID]: [{ ...contractResponse[HANDLER_ID][0], spec: undefined }] }],
  ])("rejects %s", (_label, data) => {
    expect(isContractEntry(data)).toBe(false)
  })
})

describe("normalizeUcpHandlers", () => {
  it("maps the legacy entry to one canonical entry", () => {
    const normalized = normalizeUcpHandlers(recorded("legacy-handlers.json"))!
    expect(normalized[HANDLER_ID]).toHaveLength(1)
    expect(normalized[HANDLER_ID][0]).toMatchObject({
      id: HANDLER_ID,
      version: "2026-01-15",
      spec: "https://gw.example/ucp/prism.md",
      schema: "https://gw.example/ucp/schema.json",
      config: {},
    })
  })

  it("keeps the current entry as served", () => {
    const current = recorded("current-handlers-2026-04-08.json")
    expect(normalizeUcpHandlers(current)).toEqual(current)
  })
})

describe("PrismPaymentHandlerAdapter UCP discovery guard", () => {
  let adapter: PrismPaymentHandlerAdapter
  let fetchUcpHandlers: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    adapter = new PrismPaymentHandlerAdapter({}, { api_url: "https://gw.test", api_key: "key" })
    fetchUcpHandlers = vi.spyOn((adapter as any).client as PrismClient, "fetchUcpHandlers")
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

  it("serves the canonical entry when Prism still answers with the legacy entry", async () => {
    fetchUcpHandlers.mockResolvedValue(recorded("legacy-handlers.json"))
    const handlers = await adapter.getUcpDiscoveryHandlers("2026-08-25")
    expect(handlers[HANDLER_ID][0]).toMatchObject({ id: HANDLER_ID, schema: "https://gw.example/ucp/schema.json" })
  })

  it("caches per UCP version and asks Prism for that version", async () => {
    fetchUcpHandlers.mockResolvedValue(contractResponse)
    await adapter.getUcpDiscoveryHandlers("2026-08-25")
    await adapter.getUcpDiscoveryHandlers("2026-08-25")
    await adapter.getUcpDiscoveryHandlers("2026-01-23")
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(2)
    expect(fetchUcpHandlers).toHaveBeenNthCalledWith(1, "2026-08-25")
    expect(fetchUcpHandlers).toHaveBeenNthCalledWith(2, "2026-01-23")
  })

  it("accepts a 2026-01-23 entry without available_instruments", async () => {
    const { available_instruments: _omit, ...entry } = contractResponse[HANDLER_ID][0]
    fetchUcpHandlers.mockResolvedValue({ [HANDLER_ID]: [entry] })
    expect(await adapter.getUcpDiscoveryHandlers("2026-01-23")).toEqual({ [HANDLER_ID]: [entry] })
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

describe("PrismClient requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("identifies the plugin in the User-Agent and passes the UCP version", async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify(contractResponse), { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await new PrismClient({ apiUrl: "https://gw.test", apiKey: "key" }).fetchUcpHandlers("2026-08-25")

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://gw.test/api/v2/merchant/ucp/handlers?ucp_version=2026-08-25")
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(`fd-medusa-prism/${readPackageVersion()}`)
  })

  it("sends the User-Agent on payment-requirements calls", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await new PrismClient({ apiUrl: "https://gw.test", apiKey: "key" }).prepareUcpPayment({
      amount: "15", currency: "usd", resourceUrl: "https://store.test/ucp/checkout-sessions/c1", resourceDescription: "Purchase",
    })

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(`fd-medusa-prism/${readPackageVersion()}`)
  })
})

describe("readPackageVersion", () => {
  it("equals the prism-payment package.json version", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"))
    expect(readPackageVersion()).toBe(manifest.version)
  })
})
