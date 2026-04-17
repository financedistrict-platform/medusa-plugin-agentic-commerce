/**
 * Validates that a webhook URL is safe to fetch server-side.
 * Rejects private/loopback/link-local IPs to prevent SSRF attacks.
 */

import dns from "dns/promises"

const PRIVATE_IP_RANGES = [
  /^127\./,                        // 127.0.0.0/8 loopback
  /^10\./,                         // 10.0.0.0/8 private
  /^172\.(1[6-9]|2\d|3[01])\./,   // 172.16.0.0/12 private
  /^192\.168\./,                   // 192.168.0.0/16 private
  /^169\.254\./,                   // 169.254.0.0/16 link-local (AWS IMDS)
  /^0\./,                          // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // 100.64.0.0/10 CGNAT
]

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip))
}

function isIpv6Loopback(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "")
  return normalized === "::1" || normalized === "::0" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80")
}

export async function validateWebhookUrl(url: string): Promise<{ valid: boolean; reason?: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, reason: "Invalid URL format" }
  }

  // Only allow http/https
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` }
  }

  // Block known dangerous hostnames
  const hostname = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, reason: "Blocked hostname" }
  }

  // Check if hostname is a raw IP
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIp(hostname)) {
      return { valid: false, reason: "Private IP addresses are not allowed" }
    }
    return { valid: true }
  }

  if (hostname.startsWith("[") || hostname.includes(":")) {
    if (isIpv6Loopback(hostname)) {
      return { valid: false, reason: "Loopback IPv6 addresses are not allowed" }
    }
    return { valid: true }
  }

  // DNS resolution check — resolve hostname and verify it's not private.
  // We reject URLs that fail DNS resolution to prevent DNS rebinding attacks
  // where an attacker's DNS server alternates between public and private IPs.
  try {
    const addresses = await dns.resolve4(hostname)
    if (addresses.length === 0) {
      return { valid: false, reason: "Hostname has no DNS records" }
    }
    for (const ip of addresses) {
      if (isPrivateIp(ip)) {
        return { valid: false, reason: "Hostname resolves to a private IP address" }
      }
    }
  } catch {
    return { valid: false, reason: "DNS resolution failed for hostname" }
  }

  return { valid: true }
}
