import type { UcpErrorInput, UcpWire } from "./ucp-wire/types"
import { DEFAULT_CURRENT_UCP_VERSION, type UcpVersionRegistry } from "./ucp-version-registry"

export { ucpSpecBase } from "./ucp-wire/types"

export const UCP_VERSION = DEFAULT_CURRENT_UCP_VERSION

export type UcpProfileOutcome = "none" | "matched" | "undeclared" | "unknown" | "unreachable" | "disabled" | "redirected"

export type ResolvedUcp = {
  version: string
  wire: UcpWire
  outcome: UcpProfileOutcome
  declared?: string
  host?: string
  location?: string
}

export type UcpRequestLike = {
  ucp?: ResolvedUcp
  scope: { resolve: (name: string) => unknown }
}

type UcpVersionedService = {
  getUcpVersion(): string
  getUcpRegistry(): UcpVersionRegistry
}

function versionedService(req: UcpRequestLike): UcpVersionedService {
  return req.scope.resolve("agenticCommerce") as UcpVersionedService
}

export function ucpVersionFor(req: UcpRequestLike): string {
  return req.ucp?.version ?? versionedService(req).getUcpVersion()
}

export function ucpWireFor(req: UcpRequestLike): UcpWire {
  return req.ucp?.wire ?? versionedService(req).getUcpRegistry().currentWire()
}

export function ucpErrorFor(req: UcpRequestLike, input: UcpErrorInput): Record<string, unknown> {
  return ucpWireFor(req).error(input)
}
