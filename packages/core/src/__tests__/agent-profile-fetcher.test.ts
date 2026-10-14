import { readFileSync } from "node:fs"
import { EventEmitter } from "node:events"
import http from "node:http"
import https from "node:https"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import {
  AGENT_PROFILE_CACHE_MAX_ENTRIES,
  AGENT_PROFILE_CACHE_TTL_MS,
  AGENT_PROFILE_MAX_IN_FLIGHT,
  AGENT_PROFILE_TIMEOUT_MS,
  createAgentProfileFetcher,
  isPublicAddress,
} from "../lib/agent-profile-fetcher"
import { readPackageVersion } from "../lib/package-version"

let server: http.Server
let base = ""
let hits: { url: string; userAgent?: string }[] = []
let hold: (() => void)[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push({ url: req.url ?? "", userAgent: req.headers["user-agent"] })
    if (req.url?.startsWith("/slow")) {
      hold.push(() => res.end(JSON.stringify({ ucp: { version: "2026-08-25" } })))
      return
    }
    if (req.url === "/big") {
      res.end(JSON.stringify({ ucp: { version: "2026-08-25" }, pad: "x".repeat(140_000) }))
      return
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/profile" }).end()
      return
    }
    const redirectMatch = /^\/r(301|308)$/.exec(req.url ?? "")
    if (redirectMatch) {
      res.writeHead(Number(redirectMatch[1]), { location: "/profile/" }).end()
      return
    }
    const locations: Record<string, string | undefined> = {
      "/cross": "https://other.example/profile",
      "/cross-userinfo": "https://user:secret@other.example/p",
      "/userinfo": `http://user:pass@127.0.0.1:${new URL(base).port}/profile`,
      "/twice": "/redirect",
      "/missing": undefined,
      "/long": `https://other.example/${"a".repeat(600)}`,
      "/to-big": "/big",
    }
    if (req.url && req.url in locations) {
      const location = locations[req.url]
      res.writeHead(302, location === undefined ? {} : { location }).end()
      return
    }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ ucp: { version: "2026-08-25" } }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const release of hold) release()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  hits = []
  hold = []
})

describe("isPublicAddress", () => {
  it.each(["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.5"])(
    "rejects %s", (address) => {
      expect(isPublicAddress(address)).toBe(false)
    })

  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])("accepts %s", (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })
})

describe("createAgentProfileFetcher", () => {
  it("reads ucp.version from a loopback profile only with the test flag and sends the plugin User-Agent", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(hits[0].userAgent).toBe(`fd-medusa-ucp/${readPackageVersion()}`)
  })

  it("rejects the same loopback URL with the default fetcher without a request", async () => {
    expect(await createAgentProfileFetcher().lookup(`${base}/profile`)).toEqual({ status: "failed" })
    expect(hits).toHaveLength(0)
  })

  it("rejects an https host that resolves to a private address without connecting", async () => {
    const fetcher = createAgentProfileFetcher({ lookupHost: async () => [{ address: "10.0.0.5", family: 4 }] })
    expect(await fetcher.lookup("https://agent.example/.well-known/ucp")).toEqual({ status: "failed" })
  })

  it("rejects a host when any resolved address is private", async () => {
    const fetcher = createAgentProfileFetcher({
      lookupHost: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }],
    })
    expect(await fetcher.lookup("https://agent.example/.well-known/ucp")).toEqual({ status: "failed" })
  })

  it("caps the body at 128 KiB", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/big`)).toEqual({ status: "failed" })
  })

  it.each(["/r301", "/r308"])("follows one same-origin redirect from %s", async (path) => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}${path}`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(hits.map((h) => h.url)).toEqual([path, "/profile/"])
  })

  it("caches the redirect result under the original URL only", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/redirect`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(await fetcher.lookup(`${base}/redirect`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(hits.map((h) => h.url)).toEqual(["/redirect", "/profile", "/profile"])
  })

  it("reports a cross-origin redirect without following it", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/cross`)).toEqual({ status: "redirected", location: "https://other.example/profile" })
    expect(hits).toHaveLength(1)
  })

  it("strips userinfo from a reported cross-origin Location", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/cross-userinfo`)).toEqual({ status: "redirected", location: "https://other.example/p" })
  })

  it("reports an https to http downgrade on the same host and port", async () => {
    const requests: string[] = []
    const spy = vi.spyOn(https, "request").mockImplementation(((url: URL, _options: unknown, callback: (res: unknown) => void) => {
      requests.push(url.href)
      const response = Object.assign(new EventEmitter(), {
        statusCode: 302,
        headers: { location: "http://agent.example:8443/profile" },
        resume: () => undefined,
      })
      queueMicrotask(() => callback(response))
      return Object.assign(new EventEmitter(), { destroy: () => undefined, end: () => undefined })
    }) as never)
    try {
      const fetcher = createAgentProfileFetcher({ lookupHost: async () => [{ address: "93.184.216.34", family: 4 }] })
      expect(await fetcher.lookup("https://agent.example:8443/profile")).toEqual({ status: "redirected", location: "http://agent.example:8443/profile" })
      expect(requests).toEqual(["https://agent.example:8443/profile"])
    } finally {
      spy.mockRestore()
    }
  })

  it("reports a redirect whose Location carries userinfo", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    const result = await fetcher.lookup(`${base}/userinfo`)
    expect(result).toEqual({ status: "redirected", location: `${base}/profile` })
    expect(hits).toHaveLength(1)
  })

  it("reports a second redirect instead of following it", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/twice`)).toEqual({ status: "redirected", location: `${base}/profile` })
    expect(hits.map((h) => h.url)).toEqual(["/twice", "/redirect"])
  })

  it("reports a redirect without a Location header", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/missing`)).toEqual({ status: "redirected", location: null })
  })

  it("truncates a long Location to 512 characters", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    const result = await fetcher.lookup(`${base}/long`)
    expect(result.status === "redirected" && result.location?.length).toBe(512)
  })

  it("still caps the body after a redirect", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/to-big`)).toEqual({ status: "failed" })
    expect(hits.map((h) => h.url)).toEqual(["/to-big", "/big"])
  })

  it("caches a failure for 600 s without fetching again", async () => {
    let now = 1_000_000
    let lookups = 0
    const fetcher = createAgentProfileFetcher({
      clock: () => now,
      lookupHost: async () => { lookups++; return [{ address: "10.0.0.5", family: 4 }] },
    })
    const url = "https://agent.example/.well-known/ucp"
    await fetcher.lookup(url)
    now += AGENT_PROFILE_CACHE_TTL_MS - 1
    expect(await fetcher.lookup(url)).toEqual({ status: "failed" })
    expect(lookups).toBe(1)
    now += 2
    await fetcher.lookup(url)
    expect(lookups).toBe(2)
  })

  it("caches a success for 600 s", async () => {
    let now = 5_000_000
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true, clock: () => now })
    await fetcher.lookup(`${base}/cached`)
    await fetcher.lookup(`${base}/cached`)
    expect(hits).toHaveLength(1)
    now += AGENT_PROFILE_CACHE_TTL_MS + 1
    await fetcher.lookup(`${base}/cached`)
    expect(hits).toHaveLength(2)
  })

  it("evicts the oldest entry when the 1001st profile is cached", async () => {
    const resolved: string[] = []
    const fetcher = createAgentProfileFetcher({
      lookupHost: async (host) => { resolved.push(host); return [{ address: "10.0.0.5", family: 4 }] },
    })
    for (let i = 0; i <= AGENT_PROFILE_CACHE_MAX_ENTRIES; i++) {
      await fetcher.lookup(`https://agent-${i}.example/profile`)
    }
    expect(resolved).toHaveLength(AGENT_PROFILE_CACHE_MAX_ENTRIES + 1)
    await fetcher.lookup(`https://agent-${AGENT_PROFILE_CACHE_MAX_ENTRIES}.example/profile`)
    expect(resolved).toHaveLength(AGENT_PROFILE_CACHE_MAX_ENTRIES + 1)
    await fetcher.lookup("https://agent-0.example/profile")
    expect(resolved).toHaveLength(AGENT_PROFILE_CACHE_MAX_ENTRIES + 2)
  })

  const saturate = async (fetcher: ReturnType<typeof createAgentProfileFetcher>, count: number, client?: string) => {
    const start = hits.length
    const pending = Array.from({ length: count }, (_, i) => fetcher.lookup(`${base}/slow-${start + i}`, client))
    while (hits.length < start + count) await new Promise((r) => setTimeout(r, 5))
    return pending
  }

  const releaseAll = async (pending: Promise<unknown>[]) => {
    for (const release of hold) release()
    await Promise.all(pending)
  }

  it("answers busy without a request when the global in-flight cap is reached", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true, maxInFlightPerHost: AGENT_PROFILE_MAX_IN_FLIGHT })
    const pending = await saturate(fetcher, AGENT_PROFILE_MAX_IN_FLIGHT)

    expect(await fetcher.lookup(`${base}/slow-extra`)).toEqual({ status: "busy" })
    expect(hits).toHaveLength(AGENT_PROFILE_MAX_IN_FLIGHT)

    for (const release of hold) release()
    expect(await Promise.all(pending)).toEqual(Array(AGENT_PROFILE_MAX_IN_FLIGHT).fill({ status: "ok", version: "2026-08-25" }))
  })

  it("does not share in-flight slots between fetcher instances", async () => {
    const attacked = createAgentProfileFetcher({ allowLoopbackForTests: true, maxInFlightPerHost: AGENT_PROFILE_MAX_IN_FLIGHT })
    const pending = await saturate(attacked, AGENT_PROFILE_MAX_IN_FLIGHT)

    expect(await attacked.lookup(`${base}/profile`)).toEqual({ status: "busy" })
    const other = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await other.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })

    await releaseAll(pending)
  })

  it("caps in-flight fetches per host and leaves other hosts alone", async () => {
    const lookupHost = async () => [{ address: "10.0.0.5", family: 4 }]
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true, maxInFlightPerHost: 2, lookupHost })
    const pending = await saturate(fetcher, 2)

    expect(await fetcher.lookup(`${base}/slow-third`)).toEqual({ status: "busy" })
    expect(await fetcher.lookup("https://other.example/profile")).toEqual({ status: "failed" })
    expect(hits).toHaveLength(2)

    await releaseAll(pending)
    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
  })

  it("caps in-flight fetches per client and leaves other clients alone", async () => {
    const fetcher = createAgentProfileFetcher({
      allowLoopbackForTests: true,
      maxInFlightPerHost: AGENT_PROFILE_MAX_IN_FLIGHT,
      maxInFlightPerClient: 2,
    })
    const pending = await saturate(fetcher, 2, "203.0.113.7")

    expect(await fetcher.lookup(`${base}/slow-third`, "203.0.113.7")).toEqual({ status: "busy" })
    expect(await fetcher.lookup(`${base}/profile`, "198.51.100.9")).toEqual({ status: "ok", version: "2026-08-25" })

    await releaseAll(pending)
    expect(await fetcher.lookup(`${base}/profile-again`, "203.0.113.7")).toEqual({ status: "ok", version: "2026-08-25" })
  })

  it("shares one fetch between concurrent lookups of the same url", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    const pending = Array.from({ length: 12 }, () => fetcher.lookup(`${base}/slow-same`))
    while (hits.length < 1) await new Promise((r) => setTimeout(r, 5))

    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
    for (const release of hold) release()
    expect(await Promise.all(pending)).toEqual(Array(12).fill({ status: "ok", version: "2026-08-25" }))
    expect(hits.filter((h) => h.url === "/slow-same")).toHaveLength(1)
  })

  it("does not cache a busy answer", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true, maxInFlight: 1 })
    const pending = await saturate(fetcher, 1)

    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "busy" })
    await releaseAll(pending)
    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(hits.filter((h) => h.url === "/profile")).toHaveLength(1)
  })

  it("answers busy with the last known profile for the same url", async () => {
    let now = 1_000_000
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true, maxInFlight: 1, clock: () => now })
    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(await fetcher.lookup(`${base}/redirect`)).toMatchObject({ status: "ok" })
    now += AGENT_PROFILE_CACHE_TTL_MS + 1
    const pending = await saturate(fetcher, 1)

    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(await fetcher.lookup(`${base}/never-seen`)).toEqual({ status: "busy" })

    await releaseAll(pending)
  })

  it("keeps the last known profile while failures churn through the cache", async () => {
    let now = 1_000_000
    const lookupHost = async () => [{ address: "10.0.0.5", family: 4 }]
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true, maxInFlight: 1, clock: () => now, lookupHost })
    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
    for (let i = 0; i < AGENT_PROFILE_CACHE_MAX_ENTRIES + 5; i++) {
      await fetcher.lookup(`https://garbage-${i}.example/profile`)
    }
    now += AGENT_PROFILE_CACHE_TTL_MS + 1
    const pending = await saturate(fetcher, 1)

    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })

    await releaseAll(pending)
  })

  it("does not reuse an expired failure when busy", async () => {
    let now = 1_000_000
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true, maxInFlight: 1, clock: () => now })
    expect(await fetcher.lookup(`${base}/big`)).toEqual({ status: "failed" })
    now += AGENT_PROFILE_CACHE_TTL_MS + 1
    const pending = await saturate(fetcher, 1)

    expect(await fetcher.lookup(`${base}/big`)).toEqual({ status: "busy" })

    await releaseAll(pending)
  })

  it("counts DNS time against the fetch deadline and frees the slot", async () => {
    const lookupHost = () => new Promise<never>(() => undefined)
    const fetcher = createAgentProfileFetcher({ maxInFlight: 1, lookupHost })
    const started = Date.now()

    expect(await fetcher.lookup("https://stalled.example/profile")).toEqual({ status: "failed" })
    expect(Date.now() - started).toBeLessThan(AGENT_PROFILE_TIMEOUT_MS + 1_000)
    expect(await fetcher.lookup("https://stalled-again.example/profile")).toEqual({ status: "failed" })
  }, 15_000)

  it("releases its slots when the fetch throws", async () => {
    const lookupHost = async (): Promise<never> => {
      throw new Error("dns down")
    }
    const fetcher = createAgentProfileFetcher({ maxInFlight: 1, maxInFlightPerHost: 1, maxInFlightPerClient: 1, lookupHost })

    expect(await fetcher.lookup("https://broken.example/a", "203.0.113.7")).toEqual({ status: "failed" })
    expect(await fetcher.lookup("https://broken.example/b", "203.0.113.7")).toEqual({ status: "failed" })
  })
})

describe("readPackageVersion", () => {
  it("equals the core package.json version", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"))
    expect(readPackageVersion()).toBe(manifest.version)
  })
})
