export const UCP_VERSION = "2026-08-25"

export function ucpSpecBase(version: string): string {
  return `https://ucp.dev/${version}`
}

export function ucpVersionFor(scope: { resolve: (name: string) => unknown }): string {
  try {
    const service = scope.resolve("agenticCommerce") as { getUcpVersion?: () => string }
    return service.getUcpVersion?.() || UCP_VERSION
  } catch {
    return UCP_VERSION
  }
}
