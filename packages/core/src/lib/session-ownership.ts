import crypto from "crypto"
import type { AgentSessionRecord } from "./agent-session"
import { presentedApiKey } from "./presented-api-key"

export const UCP_SESSION_SECRET_HEADER = "UCP-Session-Secret"

type HeaderBag = Record<string, string | string[] | undefined>

function digest(scope: string, value: string): string {
  return crypto.createHash("sha256").update(`${scope}:${value}`).digest("hex")
}

function headerValue(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  return typeof value === "string" ? value.trim() || undefined : undefined
}

function acpFingerprint(headers: HeaderBag): string | null {
  const apiKey = presentedApiKey(headers)
  return apiKey ? digest("acp", apiKey) : null
}

function ucpFingerprint(headers: HeaderBag): string | null {
  const secret = headerValue(headers, UCP_SESSION_SECRET_HEADER)
  return secret ? digest("ucp-session", secret) : null
}

export function issueUcpSessionSecret(): { secret: string; fingerprint: string } {
  const secret = crypto.randomBytes(32).toString("base64url")
  return { secret, fingerprint: digest("ucp-session", secret) }
}

export type SessionProtocol = "acp" | "ucp"

export function computeSessionFingerprint(protocol: SessionProtocol, headers: HeaderBag): string | null {
  return protocol === "ucp" ? ucpFingerprint(headers) : acpFingerprint(headers)
}

export function verifySessionOwnership(
  session: Pick<AgentSessionRecord, "session_fingerprint"> | null | undefined,
  fingerprint: string | null
): boolean {
  const stored = session?.session_fingerprint
  if (!stored || !fingerprint) return false
  const expected = Buffer.from(stored)
  const presented = Buffer.from(fingerprint)
  return expected.length === presented.length && crypto.timingSafeEqual(expected, presented)
}
