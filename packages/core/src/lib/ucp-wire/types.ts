import type { UcpErrorSeverity } from "../error-formatters"

export type UcpCapability = "catalog" | "cart" | "checkout" | "order"

export type UcpProfileInput = {
  requestBaseUrl: string
  publicBaseUrl: string
  storeName: string
  handlers: Record<string, unknown[]>
  supportedVersions: Record<string, string>
}

export type UcpErrorInput = {
  code: string
  content: string
  severity?: UcpErrorSeverity
  path?: string
}

export interface UcpWire {
  readonly version: string
  readonly lineItemTotalType: string
  profile(input: UcpProfileInput): Record<string, unknown>
  envelopeCapabilities(): Record<string, { version: string }[]>
  checkoutHandlers(handlers: Record<string, unknown[]>): Record<string, unknown[]>
  error(input: UcpErrorInput): Record<string, unknown>
  supports(capability: UcpCapability): boolean
  completedPaymentHandlerId(handlerId: string | undefined): string | undefined
}

export function ucpSpecBase(version: string): string {
  return `https://ucp.dev/${version}`
}

export function withSupportedVersions(
  ucp: Record<string, unknown>,
  supportedVersions: Record<string, string>,
): Record<string, unknown> {
  if (Object.keys(supportedVersions).length === 0) return ucp
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(ucp)) {
    result[key] = value
    if (key === "version") result.supported_versions = supportedVersions
  }
  return result
}

export function standardUcpError(version: string, input: UcpErrorInput): Record<string, unknown> {
  return {
    ucp: { version, status: "error" },
    messages: [{
      type: "error",
      code: input.code,
      content: input.content,
      severity: input.severity || "unrecoverable",
      ...(input.path ? { path: input.path } : {}),
    }],
  }
}
