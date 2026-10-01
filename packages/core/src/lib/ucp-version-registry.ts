import type { UcpWire } from "./ucp-wire/types"
import { wire20260123 } from "./ucp-wire/wire-2026-01-23"
import { wire20260408 } from "./ucp-wire/wire-2026-04-08"
import { wire20260825 } from "./ucp-wire/wire-2026-08-25"

export const DEFAULT_CURRENT_UCP_VERSION = "2026-04-08"
export const DEFAULT_SUPPORTED_UCP_VERSIONS: readonly string[] = ["2026-08-25", "2026-01-23"]

export type UcpVersionNegotiation = "lenient" | "strict"

export const UCP_VERSION_NEGOTIATION_MODES: readonly UcpVersionNegotiation[] = ["lenient", "strict"]

const WIRES: Record<string, UcpWire> = {
  [wire20260825.version]: wire20260825,
  [wire20260408.version]: wire20260408,
  [wire20260123.version]: wire20260123,
}

export const KNOWN_UCP_VERSIONS: readonly string[] = Object.keys(WIRES)

export type UcpVersionRegistryOptions = {
  ucp_version?: string
  ucp_supported_versions?: string[]
  ucp_version_negotiation?: string
}

export type UcpVersionRegistry = {
  readonly current: string
  readonly supported: readonly string[]
  readonly negotiation: UcpVersionNegotiation
  enabled(): string[]
  isKnown(version: string): boolean
  isEnabled(version: string): boolean
  wire(version: string): UcpWire
  currentWire(): UcpWire
}

export function isKnownUcpVersion(version: string): boolean {
  return Object.prototype.hasOwnProperty.call(WIRES, version)
}

export function createUcpVersionRegistry(options: UcpVersionRegistryOptions = {}): UcpVersionRegistry {
  const current = options.ucp_version || DEFAULT_CURRENT_UCP_VERSION
  if (!isKnownUcpVersion(current)) {
    throw new Error(`Unknown UCP version: ${current}`)
  }

  const requested = options.ucp_supported_versions ?? [...DEFAULT_SUPPORTED_UCP_VERSIONS]
  for (const version of requested) {
    if (!isKnownUcpVersion(version)) {
      throw new Error(`Unknown supported UCP version: ${version}`)
    }
  }
  const supported = [...new Set(requested.filter((version) => version !== current))]

  const negotiation = (options.ucp_version_negotiation || "lenient") as UcpVersionNegotiation
  if (!UCP_VERSION_NEGOTIATION_MODES.includes(negotiation)) {
    throw new Error(`Unknown UCP version negotiation: ${options.ucp_version_negotiation}`)
  }

  const enabled = [current, ...supported]
  const wire = (version: string): UcpWire => {
    if (!isKnownUcpVersion(version)) {
      throw new Error(`Unknown UCP version: ${version}`)
    }
    return WIRES[version]
  }

  return {
    current,
    supported,
    negotiation,
    enabled: () => [...enabled],
    isKnown: isKnownUcpVersion,
    isEnabled: (version: string) => enabled.includes(version),
    wire,
    currentWire: () => wire(current),
  }
}
