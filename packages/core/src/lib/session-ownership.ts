/**
 * Session ownership utilities.
 *
 * Generates a fingerprint from the caller's identity and stores it in cart
 * metadata at session creation. Subsequent operations verify the fingerprint
 * matches, preventing one agent from modifying another's checkout session.
 *
 * For ACP: fingerprint = SHA-256(API key from Authorization header)
 * For UCP: fingerprint = SHA-256(UCP-Agent header + Bearer token if present)
 *
 * This is defense-in-depth — UCP has no real auth so the fingerprint is
 * based on best-available identity signals. ACP fingerprints are strong
 * because the API key is authenticated.
 */

import crypto from "crypto"

export function computeSessionFingerprint(req: {
  headers: Record<string, string | string[] | undefined>
}): string {
  const apiKey = (req.headers["authorization"] as string)?.replace("Bearer ", "").trim()
  const ucpAgent = req.headers["ucp-agent"] as string

  // ACP: use the authenticated API key
  if (apiKey) {
    return crypto.createHash("sha256").update(`acp:${apiKey}`).digest("hex")
  }

  // UCP: use UCP-Agent header (best-available, not cryptographically strong)
  if (ucpAgent) {
    return crypto.createHash("sha256").update(`ucp:${ucpAgent}`).digest("hex")
  }

  return "anonymous"
}

export function verifySessionOwnership(
  cartMetadata: Record<string, unknown> | undefined,
  fingerprint: string
): boolean {
  if (!cartMetadata?.session_fingerprint) {
    // Legacy sessions without fingerprint — allow (backwards compat)
    return true
  }
  return cartMetadata.session_fingerprint === fingerprint
}
