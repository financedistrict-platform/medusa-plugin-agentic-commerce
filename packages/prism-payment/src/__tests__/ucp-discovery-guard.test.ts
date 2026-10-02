import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"
import PrismPaymentProviderService from "../modules/prism-payment/service"
import { PrismClient, isContractEntry, normalizeUcpHandlers } from "../lib/prism-client"

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
  const userAgentOf = (fetchStub: ReturnType<typeof vi.fn>) => {
    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    return (init.headers as Record<string, string>)["User-Agent"]
  }
  const urlOf = (fetchStub: ReturnType<typeof vi.fn>) => fetchStub.mock.calls[0][0] as unknown as string

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the UCP version as User-Agent and no query on UCP handlers", async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify(contractResponse), { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().fetchUcpHandlers(UCP_VERSION)

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/ucp/handlers")
    expect(userAgentOf(fetchStub)).toBe("fd-medusa-prism/2026-08-25")
  })

  it("sends the UCP version as User-Agent and no query on ACP handlers", async () => {
    const fetchStub = vi.fn(async () => new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().fetchAcpHandlers("2026-04-08")

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/acp/handlers")
    expect(userAgentOf(fetchStub)).toBe("fd-medusa-prism/2026-04-08")
  })

  it("sends the UCP version as User-Agent on UCP payment-requirements", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().prepareUcpPayment(prepareInput, "2026-01-23")

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/ucp/payment-requirements")
    expect(userAgentOf(fetchStub)).toBe("fd-medusa-prism/2026-01-23")
  })

  it("sends the UCP version as User-Agent on ACP payment-requirements", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().prepareAcpPayment(prepareInput, UCP_VERSION)

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/acp/payment-requirements")
    expect(userAgentOf(fetchStub)).toBe("fd-medusa-prism/2026-08-25")
  })

  it.each([undefined, "", "latest", "2026-8-25"])("rejects the UCP version %j without sending a request", async (version) => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)
    const bad = version as unknown as string

    await expect(client().fetchUcpHandlers(bad)).rejects.toThrow(/UCP version.*Upgrade @financedistrict\/medusa-plugin-agentic-commerce/)
    await expect(client().fetchAcpHandlers(bad)).rejects.toThrow(/UCP version/)
    await expect(client().prepareUcpPayment(prepareInput, bad)).rejects.toThrow(/UCP version/)
    await expect(client().prepareAcpPayment(prepareInput, bad)).rejects.toThrow(/UCP version/)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})

describe("PrismPaymentHandlerAdapter version forwarding", () => {
  it("passes the checkout request version to both prepare calls", async () => {
    const adapter = new PrismPaymentHandlerAdapter({}, {})
    const prepareUcp = vi.fn().mockResolvedValue({ ok: true })
    const prepareAcp = vi.fn().mockResolvedValue({ ok: true })
    ;(adapter as any).client = { prepareUcpPayment: prepareUcp, prepareAcpPayment: prepareAcp }

    await adapter.prepareCheckoutPayment({
      cart: { id: "c1", total: 5, currency_code: "usd", metadata: {} },
      checkoutBaseUrl: "https://store.test/ucp/checkout-sessions",
      storeName: "Test",
      ucpVersion: "2026-01-23",
      container: { resolve: () => ({ updateCarts: vi.fn() }) },
    })

    expect(prepareUcp.mock.calls[0][1]).toBe("2026-01-23")
    expect(prepareAcp.mock.calls[0][1]).toBe("2026-01-23")
  })

  it("asks Prism for ACP handlers with the given version and caches per version", async () => {
    const adapter = new PrismPaymentHandlerAdapter({}, {})
    const fetchAcp = vi.fn().mockResolvedValue([])
    ;(adapter as any).client = { fetchAcpHandlers: fetchAcp, getApiUrl: () => "https://gw.test" }

    await adapter.getAcpDiscoveryHandlers("2026-08-25")
    await adapter.getAcpDiscoveryHandlers("2026-08-25")
    await adapter.getAcpDiscoveryHandlers("2026-04-08")

    expect(fetchAcp).toHaveBeenCalledTimes(2)
    expect(fetchAcp).toHaveBeenNthCalledWith(1, "2026-08-25")
    expect(fetchAcp).toHaveBeenNthCalledWith(2, "2026-04-08")
  })
})

describe("Prism provider payment calls", () => {
  const authorization = {
    x402Version: 2,
    paymentPayload: {
      network: "base",
      payload: { authorization: { from: "0xA", value: "1", validBefore: String(Math.floor(Date.now() / 1000) + 3600) } },
    },
    paymentRequirements: { scheme: "exact" },
  }
  const encoded = Buffer.from(JSON.stringify(authorization)).toString("base64")
  const provider = () => new PrismPaymentProviderService({}, { api_url: "https://gw.test", api_key: "key" } as any)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the session UCP version as User-Agent on verify and settle", async () => {
    const fetchStub = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith("/verify") ? { isValid: true } : { success: true, transaction: "0xtx" }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchStub)

    const result = await provider().authorizePayment({ data: { eip3009_authorization: encoded, ucp_version: "2026-01-23" } } as any)

    expect(result.status).toBe("authorized")
    const calls = fetchStub.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url]) => url)).toEqual([
      "https://gw.test/api/v2/payment/verify",
      "https://gw.test/api/v2/payment/settle",
    ])
    for (const [, init] of calls) {
      expect((init.headers as Record<string, string>)["User-Agent"]).toBe("fd-medusa-prism/2026-01-23")
    }
  })

  it("settles on capture with the version kept in the session data", async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ success: true, transaction: "0xtx" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await provider().capturePayment({ data: { x402_authorization: encoded, ucp_version: "2026-08-25" } } as any)

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("fd-medusa-prism/2026-08-25")
  })

  it("carries the UCP version from the payment session input", async () => {
    const session = await provider().initiatePayment({ amount: 1, currency_code: "usd", data: { ucp_version: "2026-04-08" } } as any)
    expect(session.data).toMatchObject({ ucp_version: "2026-04-08" })
  })

  it("fails without a request when the session has no UCP version", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    const result = await provider().authorizePayment({ data: { eip3009_authorization: encoded } } as any)

    expect(result.status).toBe("error")
    expect((result.data as Record<string, unknown>).error).toBe("settlement_error: payment session is missing ucp_version")
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it("throws on capture when the session has no UCP version", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await expect(provider().capturePayment({ data: { x402_authorization: encoded } } as any)).rejects.toThrow("missing ucp_version")
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
