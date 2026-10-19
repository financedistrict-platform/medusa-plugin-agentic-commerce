import crypto from "node:crypto"
import http from "node:http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AgenticCommerceService from "../modules/agentic-commerce/service"
import { createWebhookDelivery } from "../lib/webhook-delivery"

type Hit = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

const servers: http.Server[] = []

function listen(handler: (hit: Hit, res: http.ServerResponse) => void): Promise<{ port: number; hits: Hit[] }> {
  const hits: Hit[] = []
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        const hit = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body }
        hits.push(hit)
        handler(hit, res)
      })
    })
    servers.push(server)
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as { port: number }).port, hits }))
  })
}

class LoopbackService extends AgenticCommerceService {
  constructor(options: ConstructorParameters<typeof AgenticCommerceService>[1] = {}) {
    super({}, { payment_provider_id: "pp_prism_prism", signatureKey: "merchant-key", ...options })
    this.webhookDelivery = createWebhookDelivery({ allowLoopbackForTests: true })
  }
}

const event = (url: string) => ({ url, event_type: "order.created", payload: { order_id: "o_1" }, maxRetries: 1 })

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

describe("webhook target resolution", () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }]
  const delivery = createWebhookDelivery({ lookupHost: publicLookup })

  it.each([
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:10.0.0.5]/",
    "http://[::ffff:100.64.0.1]/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
  ])("rejects the literal address in %s", async (url) => {
    expect((await delivery.resolve(url)).valid).toBe(false)
  })

  it.each([
    ["a private IPv4 address", [{ address: "10.0.0.5", family: 4 }]],
    ["a link-local address", [{ address: "169.254.169.254", family: 4 }]],
    ["a carrier-grade NAT address", [{ address: "100.64.0.9", family: 4 }]],
    ["a mapped loopback address", [{ address: "::ffff:7f00:1", family: 6 }]],
    ["a unique-local IPv6 address", [{ address: "fd00::5", family: 6 }]],
    ["one private address among public ones", [{ address: "93.184.216.34", family: 4 }, { address: "192.168.0.7", family: 4 }]],
    ["no addresses", []],
  ])("rejects a hostname that resolves to %s", async (_label, addresses) => {
    const result = await createWebhookDelivery({ lookupHost: async () => addresses }).resolve("https://hooks.example.test/hook")
    expect(result.valid).toBe(false)
  })

  it("rejects a hostname that does not resolve", async () => {
    const failing = createWebhookDelivery({ lookupHost: async () => { throw new Error("ENOTFOUND") } })
    expect((await failing.resolve("https://hooks.example.test/hook")).valid).toBe(false)
  })

  it.each(["ftp://hooks.example.test/hook", "file:///etc/passwd", "not a url", "https://user:pass@hooks.example.test/hook"])(
    "rejects %s",
    async (url) => {
      expect((await delivery.resolve(url)).valid).toBe(false)
    },
  )

  it("rejects loopback unless the test flag is set", async () => {
    expect((await createWebhookDelivery().resolve("http://127.0.0.1:9/hook")).valid).toBe(false)
    expect((await createWebhookDelivery({ allowLoopbackForTests: true }).resolve("http://127.0.0.1:9/hook")).valid).toBe(true)
  })

  it.each([
    ["https://hooks.example.test/hook", "93.184.216.34", 4],
    ["https://93.184.216.34/hook", "93.184.216.34", 4],
    ["https://[2606:2800:220:1:248:1893:25c8:1946]/hook", "2606:2800:220:1:248:1893:25c8:1946", 6],
  ])("accepts %s and pins %s", async (url, address, family) => {
    const result = await delivery.resolve(url)
    expect(result).toMatchObject({ valid: true, target: { address, family } })
  })

  it("looks up the lower-case host name and keeps the port", async () => {
    const lookups: string[] = []
    const recording = createWebhookDelivery({
      lookupHost: async (host) => {
        lookups.push(host)
        return [{ address: "93.184.216.34", family: 4 }]
      },
    })

    const result = await recording.resolve("HTTPS://Hooks.Example.TEST.:8443/hook")

    expect(lookups).toEqual(["hooks.example.test."])
    expect(result).toMatchObject({ valid: true, target: { address: "93.184.216.34" } })
    expect(result.valid && result.target.url.port).toBe("8443")
  })

  it("accepts public addresses next to the carrier-grade NAT range", async () => {
    expect((await delivery.resolve("https://100.63.255.255/hook")).valid).toBe(true)
    expect((await delivery.resolve("https://100.128.0.0/hook")).valid).toBe(true)
  })
})

describe("webhook delivery", () => {
  it("connects to the validated address, not to a fresh lookup of the hostname", async () => {
    const receiver = await listen((_hit, res) => res.writeHead(200).end())
    const delivery = createWebhookDelivery()

    const status = await delivery.post(
      { url: new URL(`http://rebind.invalid:${receiver.port}/hook`), address: "127.0.0.1", family: 4 },
      "{}",
      { "Content-Type": "application/json" },
    )

    expect(status).toBe(200)
    expect(receiver.hits).toHaveLength(1)
    expect(receiver.hits[0].headers.host).toBe(`rebind.invalid:${receiver.port}`)
  })

  it("sends the signed event to the receiver", async () => {
    const receiver = await listen((_hit, res) => res.writeHead(200).end())

    const result = await new LoopbackService().sendWebhookEvent(event(`http://127.0.0.1:${receiver.port}/hook`))

    const [hit] = receiver.hits
    expect(result).toEqual({ status: 200, success: true })
    expect(hit.method).toBe("POST")
    expect(hit.url).toBe("/hook")
    expect(hit.headers["content-type"]).toBe("application/json")
    expect(JSON.parse(hit.body)).toEqual({ type: "order.created", data: { order_id: "o_1" } })
    expect(hit.headers["merchant-signature"]).toBe(crypto.createHmac("sha256", "merchant-key").update(hit.body).digest("hex"))
    expect(hit.headers.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it.each([301, 302, 307, 308])("does not follow a %s redirect to an internal address", async (redirectStatus) => {
    const internal = await listen((_hit, res) => res.writeHead(200).end())
    const redirecting = await listen((_hit, res) => {
      res.writeHead(redirectStatus, { Location: `http://127.0.0.1:${internal.port}/internal-only` }).end()
    })

    const result = await new LoopbackService().sendWebhookEvent({ ...event(`http://127.0.0.1:${redirecting.port}/hook`), maxRetries: 3 })

    expect(result).toEqual({ status: redirectStatus, success: false })
    expect(redirecting.hits).toHaveLength(1)
    expect(internal.hits).toHaveLength(0)
  })

  it("does not retry a client error", async () => {
    const receiver = await listen((_hit, res) => res.writeHead(410).end())

    const result = await new LoopbackService().sendWebhookEvent({ ...event(`http://127.0.0.1:${receiver.port}/hook`), maxRetries: 3 })

    expect(result).toEqual({ status: 410, success: false })
    expect(receiver.hits).toHaveLength(1)
  })

  it("retries a server error and then reports a failed delivery", async () => {
    const receiver = await listen((_hit, res) => res.writeHead(503).end())

    const result = await new LoopbackService().sendWebhookEvent({ ...event(`http://127.0.0.1:${receiver.port}/hook`), maxRetries: 2 })

    expect(result).toEqual({ status: 0, success: false })
    expect(receiver.hits).toHaveLength(2)
  })

  it("delivers on a retry after a server error", async () => {
    let calls = 0
    const receiver = await listen((_hit, res) => res.writeHead(++calls === 1 ? 503 : 200).end())

    const result = await new LoopbackService().sendWebhookEvent({ ...event(`http://127.0.0.1:${receiver.port}/hook`), maxRetries: 2 })

    expect(result).toEqual({ status: 200, success: true })
    expect(receiver.hits).toHaveLength(2)
  })

  it("reports an unreachable receiver as a failed delivery", async () => {
    const closed = await listen((_hit, res) => res.end())
    const port = closed.port
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))

    const result = await new LoopbackService().sendWebhookEvent(event(`http://127.0.0.1:${port}/hook`))

    expect(result).toEqual({ status: 0, success: false })
  })

  it("never contacts an address that fails validation", async () => {
    const receiver = await listen((_hit, res) => res.writeHead(200).end())
    const service = new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism", signatureKey: "merchant-key" })

    const direct = await service.sendWebhookEvent(event(`http://127.0.0.1:${receiver.port}/hook`))
    const mapped = await service.sendWebhookEvent(event(`http://[::ffff:7f00:1]:${receiver.port}/hook`))

    expect(direct).toEqual({ status: 0, success: false })
    expect(mapped).toEqual({ status: 0, success: false })
    expect(receiver.hits).toHaveLength(0)
  })
})

describe("webhook signing key", () => {
  const body = JSON.stringify({ type: "order.created", data: { order_id: "o_1" } })
  const sign = (key: string) => crypto.createHmac("sha256", key).update(body).digest("hex")

  function withoutEnvKey<T>(run: () => T): T {
    const saved = process.env.AGENTIC_COMMERCE_SIGNATURE_KEY
    delete process.env.AGENTIC_COMMERCE_SIGNATURE_KEY
    try {
      return run()
    } finally {
      if (saved !== undefined) process.env.AGENTIC_COMMERCE_SIGNATURE_KEY = saved
    }
  }

  it("rejects a signature computed with an empty key when no key is configured", () => {
    const service = withoutEnvKey(() => new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism" }))

    expect(service.verifySignature(body, sign(""))).toBe(false)
    expect(service.verifySignature(body, "")).toBe(false)
  })

  it("warns once at startup when no key is configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    withoutEnvKey(() => new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism" }))

    expect(warn.mock.calls.filter(([message]) => String(message).includes("signatureKey is not set"))).toHaveLength(1)
  })

  it("sends no webhook when no key is configured", async () => {
    const receiver = await listen((_hit, res) => res.writeHead(200).end())
    const service = withoutEnvKey(() => new LoopbackService({ signatureKey: "" }))

    const result = await service.sendWebhookEvent(event(`http://127.0.0.1:${receiver.port}/hook`))

    expect(result).toEqual({ status: 0, success: false })
    expect(receiver.hits).toHaveLength(0)
  })

  it("says at startup that webhooks are not sent without a key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    withoutEnvKey(() => new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism" }))

    expect(warn.mock.calls.filter(([message]) => String(message).includes("Outbound webhooks are not sent"))).toHaveLength(1)
  })

  it("does not warn when a key is configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism", signatureKey: "merchant-key" })

    expect(warn.mock.calls.filter(([message]) => String(message).includes("signatureKey is not set"))).toHaveLength(0)
  })

  it("verifies a signature made with the configured key and rejects any other", () => {
    const service = new AgenticCommerceService({}, { payment_provider_id: "pp_prism_prism", signatureKey: "merchant-key" })

    expect(service.verifySignature(body, sign("merchant-key"))).toBe(true)
    expect(service.verifySignature(body, sign(""))).toBe(false)
    expect(service.verifySignature(body, sign("other-key"))).toBe(false)
    expect(service.verifySignature(body, "not-hex")).toBe(false)
  })
})
