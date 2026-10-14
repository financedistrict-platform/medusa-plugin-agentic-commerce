import { promises as dns } from "node:dns"
import http from "node:http"
import https from "node:https"
import { isIP } from "node:net"
import { isPublicAddress, type ResolvedAddress } from "./agent-profile-fetcher"

export const WEBHOOK_TIMEOUT_MS = 10_000

const LOOPBACK_TEST_HOST = "127.0.0.1"

export type WebhookTarget = { url: URL; address: string; family: number }

export type WebhookTargetResult =
  | { valid: true; target: WebhookTarget }
  | { valid: false; reason: string }

export type WebhookDeliveryOptions = {
  allowLoopbackForTests?: boolean
  lookupHost?: (host: string) => Promise<ResolvedAddress[]>
}

export type WebhookDelivery = {
  resolve(rawUrl: string): Promise<WebhookTargetResult>
  post(target: WebhookTarget, body: string, headers: Record<string, string>): Promise<number>
}

async function defaultLookupHost(host: string): Promise<ResolvedAddress[]> {
  return dns.lookup(host, { all: true })
}

function rejected(reason: string): WebhookTargetResult {
  return { valid: false, reason }
}

export function createWebhookDelivery(options: WebhookDeliveryOptions = {}): WebhookDelivery {
  const allowLoopback = options.allowLoopbackForTests === true
  const lookupHost = options.lookupHost ?? defaultLookupHost

  return {
    async resolve(rawUrl: string): Promise<WebhookTargetResult> {
      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        return rejected("Invalid URL format")
      }

      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return rejected(`Unsupported protocol: ${url.protocol}`)
      }
      if (url.username !== "" || url.password !== "") {
        return rejected("Credentials in the URL are not allowed")
      }

      if (allowLoopback && url.protocol === "http:" && url.hostname === LOOPBACK_TEST_HOST) {
        return { valid: true, target: { url, address: LOOPBACK_TEST_HOST, family: 4 } }
      }

      const host = url.hostname.replace(/^\[|\]$/g, "")
      let addresses: ResolvedAddress[]
      try {
        addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookupHost(host)
      } catch {
        return rejected("DNS resolution failed for hostname")
      }
      if (addresses.length === 0) {
        return rejected("Hostname has no DNS records")
      }
      if (addresses.some((entry) => !isPublicAddress(entry.address))) {
        return rejected("Webhook URL resolves to a non-public IP address")
      }

      return { valid: true, target: { url, address: addresses[0].address, family: addresses[0].family } }
    },

    post(target: WebhookTarget, body: string, headers: Record<string, string>): Promise<number> {
      return new Promise((resolve) => {
        const pinnedLookup = (
          _hostname: string,
          lookupOptions: { all?: boolean } | undefined,
          callback: (...args: unknown[]) => void,
        ) => {
          if (lookupOptions?.all) callback(null, [{ address: target.address, family: target.family }])
          else callback(null, target.address, target.family)
        }

        const transport = target.url.protocol === "https:" ? https : http
        const request = transport.request(target.url, {
          method: "POST",
          headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
          lookup: pinnedLookup as never,
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        }, (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        })
        request.on("error", () => resolve(0))
        request.end(body)
      })
    },
  }
}
