import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PrismPaymentHandlerAdapter from "../modules/prism-payment-handler/service"
import PrismPaymentProviderService from "../modules/prism-payment/service"
import { PRISM_USER_AGENT, PrismClient, isContractEntry, normalizeUcpHandlers } from "../lib/prism-client"

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

  it("uses the package version in the constant User-Agent", () => {
    const { version } = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"))
    expect(PRISM_USER_AGENT).toBe(`fd-medusa-prism/${version}`)
  })

  it("puts the UCP version in the path of UCP handlers and sends the constant User-Agent", async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify(contractResponse), { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().fetchUcpHandlers(UCP_VERSION)

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/ucp/2026-08-25/handlers")
    expect(userAgentOf(fetchStub)).toBe(PRISM_USER_AGENT)
  })

  it("calls unversioned ACP handlers with the constant User-Agent", async () => {
    const fetchStub = vi.fn(async () => new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().fetchAcpHandlers()

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/acp/handlers")
    expect(userAgentOf(fetchStub)).toBe(PRISM_USER_AGENT)
  })

  it("puts the UCP version in the path of UCP payment-requirements", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().prepareUcpPayment(prepareInput, "2026-01-23")

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/ucp/2026-01-23/payment-requirements")
    expect(userAgentOf(fetchStub)).toBe(PRISM_USER_AGENT)
  })

  it("calls unversioned ACP payment-requirements with the constant User-Agent", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().prepareAcpPayment(prepareInput)

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/acp/payment-requirements")
    expect(userAgentOf(fetchStub)).toBe(PRISM_USER_AGENT)
  })

  it("encodes the UCP version segment", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await client().fetchUcpHandlers("a/b")

    expect(urlOf(fetchStub)).toBe("https://gw.test/api/v2/merchant/ucp/a%2Fb/handlers")
  })
})

describe("PrismPaymentHandlerAdapter version forwarding", () => {
  it("passes the checkout request version to UCP prepare only", async () => {
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
    expect(prepareAcp.mock.calls[0]).toHaveLength(1)
  })

  it("asks Prism for ACP handlers without a version and caches the result", async () => {
    const adapter = new PrismPaymentHandlerAdapter({}, {})
    const fetchAcp = vi.fn().mockResolvedValue([])
    ;(adapter as any).client = { fetchAcpHandlers: fetchAcp, getApiUrl: () => "https://gw.test" }

    await adapter.getAcpDiscoveryHandlers()
    await adapter.getAcpDiscoveryHandlers()

    expect(fetchAcp).toHaveBeenCalledTimes(1)
    expect(fetchAcp).toHaveBeenCalledWith()
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
  const userAgents = (fetchStub: ReturnType<typeof vi.fn>) =>
    (fetchStub.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => (init.headers as Record<string, string>)["User-Agent"],
    )
  const okFetch = () =>
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith("/verify") ? { isValid: true } : { success: true, transaction: "0xtx" }), { status: 200 }),
    )

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the constant User-Agent on verify and settle whatever the session version is", async () => {
    const fetchStub = okFetch()
    vi.stubGlobal("fetch", fetchStub)

    const result = await provider().authorizePayment({ data: { eip3009_authorization: encoded, ucp_version: "2026-01-23" } } as any)

    expect(result.status).toBe("authorized")
    const calls = fetchStub.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url]) => url)).toEqual([
      "https://gw.test/api/v2/payment/verify",
      "https://gw.test/api/v2/payment/settle",
    ])
    expect(userAgents(fetchStub)).toEqual([PRISM_USER_AGENT, PRISM_USER_AGENT])
  })

  it("settles on capture with the constant User-Agent", async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ success: true, transaction: "0xtx" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchStub)

    await provider().capturePayment({ data: { x402_authorization: encoded, ucp_version: "latest" } } as any)

    expect(userAgents(fetchStub)).toEqual([PRISM_USER_AGENT])
  })

  it("carries the UCP version from the payment session input", async () => {
    const session = await provider().initiatePayment({ amount: 1, currency_code: "usd", data: { ucp_version: "2026-04-08" } } as any)
    expect(session.data).toMatchObject({ ucp_version: "2026-04-08" })
  })

  it("authorizes without auto capture and settles on capture", async () => {
    const fetchStub = okFetch()
    vi.stubGlobal("fetch", fetchStub)
    const manual = new PrismPaymentProviderService({}, { api_url: "https://gw.test", api_key: "key", auto_capture: false } as any)

    const authorized = await manual.authorizePayment({ data: { eip3009_authorization: encoded } } as any)
    expect(authorized.status).toBe("authorized")
    expect(userAgents(fetchStub)).toEqual([PRISM_USER_AGENT])

    const captured = await manual.capturePayment({ data: authorized.data } as any)
    expect((captured.data as Record<string, unknown>).prism_tx_id).toBe("0xtx")
    expect(userAgents(fetchStub)).toEqual([PRISM_USER_AGENT, PRISM_USER_AGENT])
  })
})
