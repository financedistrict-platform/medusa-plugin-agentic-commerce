import { promises as dns } from "node:dns"
import http from "node:http"
import https from "node:https"
import { BlockList, isIP } from "node:net"
import { readPackageVersion } from "./package-version"

export const AGENT_PROFILE_CACHE_TTL_MS = 600_000
export const AGENT_PROFILE_CACHE_MAX_ENTRIES = 1000
export const AGENT_PROFILE_MAX_IN_FLIGHT = 16
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
}

export type AgentProfileFetcher = {
  lookup(url: string): Promise<AgentProfileResult>
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

let inFlight = 0

async function defaultLookupHost(host: string): Promise<ResolvedAddress[]> {
  return dns.lookup(host, { all: true })
}

export function createAgentProfileFetcher(options: AgentProfileFetcherOptions = {}): AgentProfileFetcher {
  const allowLoopback = options.allowLoopbackForTests === true
  const lookupHost = options.lookupHost ?? defaultLookupHost
  const clock = options.clock ?? Date.now
  const cache = new Map<string, CacheEntry>()

  const remember = (url: string, result: AgentProfileResult) => {
    cache.delete(url)
    if (cache.size >= AGENT_PROFILE_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(url, { result, expiresAt: clock() + AGENT_PROFILE_CACHE_TTL_MS })
    return result
  }

  const cached = (url: string): AgentProfileResult | undefined => {
    const entry = cache.get(url)
    if (!entry) return undefined
    if (entry.expiresAt <= clock()) {
      cache.delete(url)
      return undefined
    }
    cache.delete(url)
    cache.set(url, entry)
    return entry.result
  }

  return {
    async lookup(url: string): Promise<AgentProfileResult> {
      const hit = cached(url)
      if (hit) return hit
      if (inFlight >= AGENT_PROFILE_MAX_IN_FLIGHT) return { status: "busy" }

      inFlight++
      try {
        return remember(url, await fetchProfile(url, allowLoopback, lookupHost))
      } finally {
        inFlight--
      }
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

  let target: ResolvedAddress
  if (loopback) {
    target = { address: LOOPBACK_TEST_HOST, family: 4 }
  } else {
    const host = url.hostname.replace(/^\[|\]$/g, "")
    let addresses: ResolvedAddress[]
    try {
      addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookupHost(host)
    } catch {
      return { status: "failed" }
    }
    if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
      return { status: "failed" }
    }
    target = addresses[0]
  }

  const deadline = Date.now() + AGENT_PROFILE_TIMEOUT_MS
  let downloaded = await download(url, target, loopback, AGENT_PROFILE_TIMEOUT_MS)

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
