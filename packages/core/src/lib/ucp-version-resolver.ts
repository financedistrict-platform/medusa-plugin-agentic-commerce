import type { AgentProfileFetcher } from "./agent-profile-fetcher"
import type { UcpVersionRegistry } from "./ucp-version-registry"
import type { ResolvedUcp, UcpProfileOutcome } from "./ucp-version"

export type UcpResolutionRejection = {
  status: 422 | 424
  code: string
  content: string
}

export type UcpResolution = ResolvedUcp & {
  rejection?: UcpResolutionRejection
}

const FALLBACK_OUTCOMES: readonly UcpProfileOutcome[] = ["undeclared", "unknown", "unreachable"]

export function isFallbackOutcome(outcome: UcpProfileOutcome): boolean {
  return FALLBACK_OUTCOMES.includes(outcome)
}

export function parseUcpAgentProfile(header: string | undefined): string | null {
  if (typeof header !== "string") return null
  const match = /profile="([^"]+)"/.exec(header)
  return match ? match[1] : null
}

export function unsupportedVersionMessage(registry: UcpVersionRegistry, requested: string): string {
  return `Version ${requested} is not supported. This business implements versions ${registry.enabled().join(", ")}.`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

function served(registry: UcpVersionRegistry, version: string, outcome: UcpProfileOutcome, declared?: string, host?: string): UcpResolution {
  return { version, wire: registry.wire(version), outcome, declared, host }
}

function rejected(
  registry: UcpVersionRegistry,
  outcome: UcpProfileOutcome,
  rejection: UcpResolutionRejection,
  declared?: string,
  host?: string,
): UcpResolution {
  return { ...served(registry, registry.current, outcome, declared, host), rejection }
}

export async function resolveUcpVersion(
  registry: UcpVersionRegistry,
  agentHeader: string | undefined,
  fetcher: AgentProfileFetcher,
): Promise<UcpResolution> {
  const url = parseUcpAgentProfile(agentHeader)
  if (!url) return served(registry, registry.current, "none")

  const host = hostOf(url)
  const profile = await fetcher.lookup(url)
  const declared = profile.status === "ok" && profile.version ? profile.version : undefined

  let outcome: UcpProfileOutcome
  if (profile.status !== "ok") outcome = "unreachable"
  else if (!declared) outcome = "undeclared"
  else if (!registry.isKnown(declared)) outcome = "unknown"
  else if (!registry.isEnabled(declared)) outcome = "disabled"
  else outcome = "matched"

  if (outcome === "matched") return served(registry, declared!, outcome, declared, host)

  if (outcome === "disabled") {
    return rejected(registry, outcome, {
      status: 422,
      code: "version_unsupported",
      content: unsupportedVersionMessage(registry, declared!),
    }, declared, host)
  }

  if (registry.negotiation === "strict") {
    return rejected(registry, outcome, outcome === "unreachable"
      ? { status: 424, code: "agent_profile_unavailable", content: "Agent profile could not be retrieved." }
      : { status: 422, code: "version_unsupported", content: unsupportedVersionMessage(registry, declared ?? "undeclared") },
    declared, host)
  }

  return served(registry, registry.current, outcome, declared, host)
}

export function applyUcpSessionPin(
  registry: UcpVersionRegistry,
  resolution: UcpResolution,
  pinned: unknown,
): UcpResolution {
  if (resolution.rejection) return resolution
  if (typeof pinned !== "string" || !registry.isKnown(pinned)) return resolution

  if (resolution.outcome === "matched") {
    if (resolution.declared === pinned) return resolution
    return rejected(registry, resolution.outcome, {
      status: 422,
      code: "version_unsupported",
      content: unsupportedVersionMessage(registry, resolution.declared!),
    }, resolution.declared, resolution.host)
  }

  return { ...resolution, version: pinned, wire: registry.wire(pinned) }
}
