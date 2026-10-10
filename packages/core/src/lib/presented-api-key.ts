type HeaderBag = Record<string, string | string[] | undefined>

const BEARER_PREFIX = "Bearer "

export function presentedApiKey(headers: HeaderBag): string | undefined {
  const apiKey = headers["x-api-key"]
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim()

  const authorization = headers["authorization"]
  if (typeof authorization === "string" && authorization.startsWith(BEARER_PREFIX)) {
    return authorization.slice(BEARER_PREFIX.length).trim() || undefined
  }
  return undefined
}
