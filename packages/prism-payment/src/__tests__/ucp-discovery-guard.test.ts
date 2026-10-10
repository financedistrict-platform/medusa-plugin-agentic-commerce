import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"
import PrismPaymentProviderService from "../modules/prism-payment/service"
import { PrismClient, isContractEntry, normalizeUcpHandlers } from "../lib/prism-client"
import { credential, encode, quotedSession } from "./helpers/quoted-payment"

const HANDLER_ID = "xyz.fd.prism_payment"
const PRISM_FIXTURES = join(__dirname, "..", "..", "..", "core", "src", "__fixtures__", "prism")

const recorded = (name: string) => JSON.parse(readFileSync(join(PRISM_FIXTURES, name), "utf8"))

const acpDeclaration = {
  id: "x402",
  name: "xyz.fd.prism_payment",
  version: "2026-01-15",
  spec: "https://gw.test/acp/prism.md",
  requires_delegate_payment: false,
  requires_pci_compliance: false,
  psp: "prism",
  config_schema: "https://gw.test/acp/config-schema.json",
  instrument_schemas: ["https://gw.test/acp/instrument-schema.json"],
  config: {},
}

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
    expect(await adapter.getUcpDiscoveryHandlers("2026-08-25")).toEqual(contractResponse)
    expect(await adapter.getUcpDiscoveryHandlers("2026-08-25")).toEqual(contractResponse)
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
    expect(await adapter.getUcpDiscoveryHandlers("2026-08-25")).toEqual({})
    expect(console.error).toHaveBeenCalledTimes(1)

    fetchUcpHandlers.mockResolvedValue(contractResponse)
    expect(await adapter.getUcpDiscoveryHandlers("2026-08-25")).toEqual({})
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(61_000)
    expect(await adapter.getUcpDiscoveryHandlers("2026-08-25")).toEqual(contractResponse)
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(2)
  })

  it("drops the expired cache when Prism is unreachable", async () => {
    fetchUcpHandlers.mockResolvedValue(contractResponse)
    await adapter.getUcpDiscoveryHandlers("2026-08-25")

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    fetchUcpHandlers.mockRejectedValue(new Error("ECONNREFUSED"))
    expect(await adapter.getUcpDiscoveryHandlers("2026-08-25")).toEqual({})
    expect(await adapter.getUcpDiscoveryHandlers("2026-08-25")).toEqual({})
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(2)
  })
})

describe("PrismClient requests", () => {
  const UCP_VERSION = "2026-08-25"
  const prepareInput = {
    amount: "15", currency: "usd", resourceUrl: "https://store.test/ucp/checkout-sessions/c1", resourceDescription: "Purchase",
  }
  const client = () => new PrismClient({ apiUrl: "https://gw.test", apiKey: "key" })
  const urlOf = (fetchStub: ReturnType<typeof vi.fn>) => fetchStub.mock.calls[0][0] as unknown as string

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("puts the UCP version in the path of UCP handlers", async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify(contractResponse), { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().fetchUcpHandlers(UCP_VERSION)

    expect(urlOf(fetchStub)).toBe("https://gw.test/ucp/2026-08-25/handlers")
  })

  it("calls unversioned ACP handlers", async () => {
    const fetchStub = vi.fn(async () => new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().fetchAcpHandlers()

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/acp/handlers")
  })

  it("posts payment-requirements without a protocol or version in the path", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().preparePayment(prepareInput)

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/payment-requirements")
  })

  it("encodes the UCP version segment", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().fetchUcpHandlers("a/b")

    expect(urlOf(fetchStub)).toBe("https://gw.test/ucp/a%2Fb/handlers")
  })
})

describe("PrismPaymentHandlerAdapter version forwarding", () => {
  const rawConfig = { x402Version: 2, resource: { url: "https://store.test/ucp/checkout-sessions/c1" }, accepts: [{ scheme: "exact", network: "base", asset: "0xA", payTo: "0xB", maxTimeoutSeconds: 60 }] }
  const prepareFor = (adapter: PrismPaymentHandlerAdapter) => adapter.prepareCheckoutPayment({
    cart: { id: "c1", total: 5, currency_code: "usd", metadata: {} },
    checkoutBaseUrl: "https://store.test/ucp/checkout-sessions",
    storeName: "Test",
    ucpVersion: "2026-01-23",
    container: { resolve: () => ({ updateCarts: vi.fn() }) },
  } as any)
  const adapterWith = (client: Record<string, unknown>) => {
    const adapter = new PrismPaymentHandlerAdapter({}, { api_key: "key" })
    ;(adapter as any).client = { getApiUrl: () => "https://gw.test", getApiKey: () => "key", fetchAcpHandlers: vi.fn().mockResolvedValue([acpDeclaration]), ...client }
    return adapter
  }

  it("composes the UCP checkout entry from discovery of the same UCP version", async () => {
    const fetchUcpHandlers = vi.fn().mockResolvedValue(contractResponse)
    const preparePayment = vi.fn().mockResolvedValue(rawConfig)
    const adapter = adapterWith({ fetchUcpHandlers, preparePayment })

    const result = await prepareFor(adapter)

    expect(result?.ucp).toEqual({ [HANDLER_ID]: [{ id: HANDLER_ID, version: "2026-10-07", config: rawConfig }] })
    const discovered = (await adapter.getUcpDiscoveryHandlers("2026-01-23"))[HANDLER_ID][0]
    expect(result?.ucp?.[HANDLER_ID][0].id).toBe(discovered.id)
    expect(result?.ucp?.[HANDLER_ID][0].version).toBe(discovered.version)
    expect(fetchUcpHandlers).toHaveBeenCalledTimes(1)
    expect(fetchUcpHandlers).toHaveBeenCalledWith("2026-01-23")
    expect(preparePayment).toHaveBeenCalledTimes(1)
    expect(preparePayment.mock.calls[0]).toHaveLength(1)
  })

  it("composes the ACP checkout entry from the cached ACP declaration", async () => {
    const fetchAcpHandlers = vi.fn().mockResolvedValue([acpDeclaration])
    const preparePayment = vi.fn().mockResolvedValue(rawConfig)
    const adapter = adapterWith({ fetchUcpHandlers: vi.fn().mockResolvedValue(contractResponse), fetchAcpHandlers, preparePayment })

    const result = await prepareFor(adapter)

    expect(result?.acp).toEqual({ ...acpDeclaration, config: rawConfig })
    const [discovered] = await adapter.getAcpDiscoveryHandlers()
    for (const key of ["id", "name", "version", "spec", "requires_delegate_payment", "requires_pci_compliance", "psp", "config_schema", "instrument_schemas"] as const) {
      expect(result?.acp?.[key]).toEqual(discovered[key])
    }
    expect(fetchAcpHandlers).toHaveBeenCalledTimes(1)
    expect(preparePayment).toHaveBeenCalledTimes(1)
  })

  it("stores no ACP entry when ACP discovery is empty", async () => {
    const preparePayment = vi.fn().mockResolvedValue(rawConfig)
    const adapter = adapterWith({
      fetchUcpHandlers: vi.fn().mockResolvedValue(contractResponse),
      fetchAcpHandlers: vi.fn().mockResolvedValue([]),
      preparePayment,
    })

    const result = await prepareFor(adapter)

    expect(result?.acp).toBeNull()
    expect(result?.ucp).not.toBeNull()
    expect(preparePayment).toHaveBeenCalledTimes(1)
  })

  it("stores no UCP entry when discovery has no declaration", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const preparePayment = vi.fn().mockResolvedValue(rawConfig)
    const adapter = adapterWith({ fetchUcpHandlers: vi.fn().mockResolvedValue({}), preparePayment })

    const result = await prepareFor(adapter)

    expect(result?.ucp).toBeNull()
    expect(result?.acp).toEqual({ ...acpDeclaration, config: rawConfig })
    expect(preparePayment).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it("stores nothing when payment-requirements fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const adapter = adapterWith({
      fetchUcpHandlers: vi.fn().mockResolvedValue(contractResponse),
      preparePayment: vi.fn().mockRejectedValue(new Error("Prism POST failed: 404")),
    })

    const result = await prepareFor(adapter)

    expect(result).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Prepare failed for cart c1"))
    vi.restoreAllMocks()
  })

  it("returns no quote when a re-prepare fails so the stale one is replaced", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const updateCarts = vi.fn().mockResolvedValue(undefined)
    const adapter = adapterWith({
      fetchUcpHandlers: vi.fn().mockResolvedValue(contractResponse),
      preparePayment: vi.fn().mockRejectedValue(new Error("Prism POST failed: 500")),
    })
    const stale = { ucp: null, acp: null, preparedAmount: "4", preparedResourceUrl: "https://store.test/ucp/checkout-sessions/c1" }

    const result = await adapter.prepareCheckoutPayment({
      cart: { id: "c1", total: 5, currency_code: "usd", metadata: { other: 1 } },
      stored: stale,
      checkoutBaseUrl: "https://store.test/ucp/checkout-sessions",
      storeName: "Test",
      ucpVersion: "2026-01-23",
      container: { resolve: () => ({ updateCarts }) },
    } as any)

    expect(result).toBeNull()
    expect(updateCarts).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it("extracts the raw x402 config from the composed entry", async () => {
    const adapter = adapterWith({
      fetchUcpHandlers: vi.fn().mockResolvedValue(contractResponse),
      preparePayment: vi.fn().mockResolvedValue(rawConfig),
    })

    const result = await prepareFor(adapter)

    expect(adapter.extractPaymentConfig(result)).toEqual(rawConfig)
  })

  it("asks Prism for ACP handlers without a version and caches the result", async () => {
    const adapter = new PrismPaymentHandlerAdapter({}, { api_key: "key" })
    const fetchAcp = vi.fn().mockResolvedValue([])
    ;(adapter as any).client = { fetchAcpHandlers: fetchAcp, getApiUrl: () => "https://gw.test" }

    await adapter.getAcpDiscoveryHandlers()
    await adapter.getAcpDiscoveryHandlers()

    expect(fetchAcp).toHaveBeenCalledTimes(1)
    expect(fetchAcp).toHaveBeenCalledWith()
  })
})

describe("Prism provider payment calls", () => {
  const encoded = encode(credential())
  const provider = () => new PrismPaymentProviderService({}, { api_url: "https://gw.test", api_key: "key" } as any)
  const okFetch = () =>
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith("/verify") ? { isValid: true } : { success: true, transaction: "0xtx" }), { status: 200 }),
    )

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("verifies and settles whatever the session version is", async () => {
    const fetchStub = okFetch()
    vi.stubGlobal("fetch", fetchStub)

    const result = await provider().authorizePayment({ data: { eip3009_authorization: encoded, ucp_version: "2026-01-23", ...quotedSession() } } as any)

    expect(result.status).toBe("authorized")
    const calls = fetchStub.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url]) => url)).toEqual([
      "https://gw.test/api/v2/payment/verify",
      "https://gw.test/api/v2/payment/settle",
    ])
  })

  it("settles on capture", async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ success: true, transaction: "0xtx" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await provider().capturePayment({ data: { x402_authorization: encoded, ucp_version: "latest", ...quotedSession() } } as any)

    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it("carries the UCP version from the payment session input", async () => {
    const session = await provider().initiatePayment({ amount: 1, currency_code: "usd", data: { ucp_version: "2026-04-08" } } as any)
    expect(session.data).toMatchObject({ ucp_version: "2026-04-08" })
  })

  it("authorizes without auto capture and settles on capture", async () => {
    const fetchStub = okFetch()
    vi.stubGlobal("fetch", fetchStub)
    const manual = new PrismPaymentProviderService({}, { api_url: "https://gw.test", api_key: "key", auto_capture: false } as any)

    const authorized = await manual.authorizePayment({ data: { eip3009_authorization: encoded, ...quotedSession() } } as any)
    expect(authorized.status).toBe("authorized")
    expect(fetchStub).toHaveBeenCalledTimes(1)

    const captured = await manual.capturePayment({ data: authorized.data } as any)
    expect((captured.data as Record<string, unknown>).prism_tx_id).toBe("0xtx")
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })
})
