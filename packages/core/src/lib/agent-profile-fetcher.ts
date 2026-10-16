import { promises as dns } from "node:dns"
import http from "node:http"
import https from "node:https"
import { BlockList, isIP } from "node:net"
import { readPackageVersion } from "./package-version"

export const AGENT_PROFILE_CACHE_TTL_MS = 600_000
export const AGENT_PROFILE_CACHE_MAX_ENTRIES = 1000
export const AGENT_PROFILE_MAX_IN_FLIGHT = 16
export const AGENT_PROFILE_MAX_IN_FLIGHT_PER_HOST = 4
export const AGENT_PROFILE_MAX_IN_FLIGHT_PER_CLIENT = 8
export const AGENT_PROFILE_MAX_BYTES = 131_072
export const AGENT_PROFILE_TIMEOUT_MS = 3_000
export const AGENT_PROFILE_MAX_LOCATION_LENGTH = 512

const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const LOOPBACK_TEST_HOST = "127.0.0.1"
const REDIRECT_STATUSES = [301, 302, 303, 307, 308]

export type AgentProfileResult =
  | { status: "ok"; version: string | null }
  | { status: "failed" }
  | { status: "redirected"; location: string | null }
  | { status: "busy" }

type DownloadResult =
  | { kind: "body"; body: string }
  | { kind: "redirect"; location: string | null }
  | { kind: "failed" }

export type ResolvedAddress = { address: string; family: number }

export type AgentProfileFetcherOptions = {
  allowLoopbackForTests?: boolean
  lookupHost?: (host: string) => Promise<ResolvedAddress[]>
  clock?: () => number
  maxInFlight?: number
  maxInFlightPerHost?: number
  maxInFlightPerClient?: number
}

export type AgentProfileFetcher = {
  lookup(url: string, client?: string): Promise<AgentProfileResult>
}

type CacheEntry = { result: AgentProfileResult; expiresAt: number }

const blocked = new BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4")
}
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6")
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, "ipv4")
  if (family !== 6) return false
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return isPublicAddress(mapped[1])
  return !blocked.check(address, "ipv6")
}

function hostKey(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return ""
  }
}

function adjust(counts: Map<string, number>, key: string, delta: number) {
  const next = (counts.get(key) ?? 0) + delta
  if (next <= 0) counts.delete(key)
  else counts.set(key, next)
}

function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (timeoutMs <= 0) {
      work.catch(() => undefined)
      reject(new Error("deadline exceeded"))
      return
    }
    const timer = setTimeout(() => reject(new Error("deadline exceeded")), timeoutMs)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function defaultLookupHost(host: string): Promise<ResolvedAddress[]> {
  return dns.lookup(host, { all: true })
}

export function createAgentProfileFetcher(options: AgentProfileFetcherOptions = {}): AgentProfileFetcher {
  const allowLoopback = options.allowLoopbackForTests === true
  const lookupHost = options.lookupHost ?? defaultLookupHost
  const clock = options.clock ?? Date.now
  const maxInFlight = options.maxInFlight ?? AGENT_PROFILE_MAX_IN_FLIGHT
  const maxPerHost = options.maxInFlightPerHost ?? AGENT_PROFILE_MAX_IN_FLIGHT_PER_HOST
  const maxPerClient = options.maxInFlightPerClient ?? AGENT_PROFILE_MAX_IN_FLIGHT_PER_CLIENT
  const profiles = new Map<string, CacheEntry>()
  const misses = new Map<string, CacheEntry>()
  const pending = new Map<string, Promise<AgentProfileResult>>()
  const perHost = new Map<string, number>()
  const perClient = new Map<string, number>()
  let inFlight = 0

  const remember = (url: string, result: AgentProfileResult) => {
    const store = result.status === "ok" ? profiles : misses
    profiles.delete(url)
    misses.delete(url)
    if (store.size >= AGENT_PROFILE_CACHE_MAX_ENTRIES) {
      const oldest = store.keys().next().value
      if (oldest !== undefined) store.delete(oldest)
    }
    store.set(url, { result, expiresAt: clock() + AGENT_PROFILE_CACHE_TTL_MS })
    return result
  }

  const cached = (url: string): AgentProfileResult | undefined => {
    const store = profiles.has(url) ? profiles : misses
    const entry = store.get(url)
    if (!entry || entry.expiresAt <= clock()) return undefined
    store.delete(url)
    store.set(url, entry)
    return entry.result
  }

  const lastKnown = (url: string): AgentProfileResult | undefined => profiles.get(url)?.result

  const acquire = (host: string, client: string | undefined): boolean => {
    if (inFlight >= maxInFlight) return false
    if ((perHost.get(host) ?? 0) >= maxPerHost) return false
    if (client !== undefined && (perClient.get(client) ?? 0) >= maxPerClient) return false
    inFlight++
    adjust(perHost, host, 1)
    if (client !== undefined) adjust(perClient, client, 1)
    return true
  }

  const release = (host: string, client: string | undefined) => {
    inFlight--
    adjust(perHost, host, -1)
    if (client !== undefined) adjust(perClient, client, -1)
  }

  return {
    async lookup(url: string, client?: string): Promise<AgentProfileResult> {
      const hit = cached(url)
      if (hit) return hit
      const shared = pending.get(url)
      if (shared) return shared

      const host = hostKey(url)
      if (!acquire(host, client)) return lastKnown(url) ?? { status: "busy" }

      const run = fetchProfile(url, allowLoopback, lookupHost)
        .then(
          (result) => remember(url, result),
          () => remember(url, { status: "failed" }),
        )
        .finally(() => {
          pending.delete(url)
          release(host, client)
        })
      pending.set(url, run)
      return run
    },
  }
}

async function fetchProfile(
  rawUrl: string,
  allowLoopback: boolean,
  lookupHost: (host: string) => Promise<ResolvedAddress[]>,
): Promise<AgentProfileResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { status: "failed" }
  }

  const loopback = allowLoopback && url.protocol === "http:" && url.hostname === LOOPBACK_TEST_HOST
  if (url.protocol !== "https:" && !loopback) return { status: "failed" }

  const deadline = Date.now() + AGENT_PROFILE_TIMEOUT_MS
  let target: ResolvedAddress
  if (loopback) {
    target = { address: LOOPBACK_TEST_HOST, family: 4 }
  } else {
    const host = url.hostname.replace(/^\[|\]$/g, "")
    let addresses: ResolvedAddress[]
    try {
      addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await withDeadline(lookupHost(host), deadline - Date.now())
    } catch {
      return { status: "failed" }
    }
    if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
      return { status: "failed" }
    }
    target = addresses[0]
  }

  const firstHopBudget = deadline - Date.now()
  if (firstHopBudget <= 0) return { status: "failed" }
  let downloaded = await download(url, target, loopback, firstHopBudget)

  if (downloaded.kind === "redirect") {
    const next = absoluteLocation(downloaded.location, url)
    if (!next) return { status: "redirected", location: null }
    if (!isSameOriginHop(url, next)) return { status: "redirected", location: truncateLocation(next) }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { status: "failed" }
    downloaded = await download(next, target, loopback, remaining)
    if (downloaded.kind === "redirect") {
      const second = absoluteLocation(downloaded.location, next)
      return { status: "redirected", location: second ? truncateLocation(second) : null }
    }
  }

  if (downloaded.kind === "failed") return { status: "failed" }

  try {
    const parsed = JSON.parse(downloaded.body) as { ucp?: { version?: unknown } }
    const version = parsed?.ucp?.version
    return { status: "ok", version: typeof version === "string" && VERSION_PATTERN.test(version) ? version : null }
  } catch {
    return { status: "ok", version: null }
  }
}

function absoluteLocation(location: string | null, base: URL): URL | null {
  if (!location) return null
  try {
    const next = new URL(location, base)
    next.hash = ""
    return next
  } catch {
    return null
  }
}

function isSameOriginHop(from: URL, to: URL): boolean {
  return to.origin === from.origin && to.username === "" && to.password === ""
}

function truncateLocation(url: URL): string {
  const reported = new URL(url)
  reported.username = ""
  reported.password = ""
  return reported.href.slice(0, AGENT_PROFILE_MAX_LOCATION_LENGTH)
}

function download(url: URL, target: ResolvedAddress, loopback: boolean, timeoutMs: number): Promise<DownloadResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: DownloadResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const pinnedLookup = (
      _hostname: string,
      lookupOptions: { all?: boolean } | undefined,
      callback: (...args: unknown[]) => void,
    ) => {
      if (lookupOptions?.all) callback(null, [{ address: target.address, family: target.family }])
      else callback(null, target.address, target.family)
    }

    const transport = loopback ? http : https
    const request = transport.request(url, {
      method: "GET",
      lookup: pinnedLookup as never,
      timeout: timeoutMs,
      headers: { "user-agent": `fd-medusa-ucp/${readPackageVersion()}`, accept: "application/json" },
    }, (response) => {
      if (response.statusCode !== undefined && REDIRECT_STATUSES.includes(response.statusCode)) {
        const location = response.headers.location
        response.resume()
        request.destroy()
        finish({ kind: "redirect", location: typeof location === "string" && location !== "" ? location : null })
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        request.destroy()
        finish({ kind: "failed" })
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > AGENT_PROFILE_MAX_BYTES) {
          request.destroy()
          finish({ kind: "failed" })
          return
        }
        chunks.push(chunk)
      })
      response.on("end", () => finish({ kind: "body", body: Buffer.concat(chunks).toString("utf8") }))
      response.on("error", () => finish({ kind: "failed" }))
    })

    const timer = setTimeout(() => {
      request.destroy()
      finish({ kind: "failed" })
    }, timeoutMs)

    request.on("timeout", () => {
      request.destroy()
      finish({ kind: "failed" })
    })
    request.on("error", () => finish({ kind: "failed" }))
    request.end()
  })
}
