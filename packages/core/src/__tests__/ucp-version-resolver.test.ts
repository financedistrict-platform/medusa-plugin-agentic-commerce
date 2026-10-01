import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import type { AgentProfileFetcher, AgentProfileResult } from "../lib/agent-profile-fetcher"
import { createUcpVersionRegistry } from "../lib/ucp-version-registry"
import { parseUcpAgentProfile, resolveUcpVersion } from "../lib/ucp-version-resolver"

const PROFILE_URL = "https://agent.example/.well-known/ucp"
const AGENT = `agent/1.0; profile="${PROFILE_URL}"`

const profileBody = (version: unknown) => JSON.stringify({ ucp: { version } })

function fixtureFetcher(body: string | null): AgentProfileFetcher {
  return {
    async lookup(): Promise<AgentProfileResult> {
      if (body === null) return { status: "failed" }
      try {
        const version = (JSON.parse(body) as { ucp?: { version?: unknown } }).ucp?.version
        return { status: "ok", version: typeof version === "string" && /^\d{4}-\d{2}-\d{2}$/.test(version) ? version : null }
      } catch {
        return { status: "ok", version: null }
      }
    },
  }
}

const lenient = createUcpVersionRegistry()
const strict = createUcpVersionRegistry({ ucp_version_negotiation: "strict" })
const withoutLegacy = createUcpVersionRegistry({ ucp_supported_versions: ["2026-08-25"] })

describe("parseUcpAgentProfile", () => {
  it("reads the profile parameter of UCP-Agent", () => {
    expect(parseUcpAgentProfile(AGENT)).toBe(PROFILE_URL)
    expect(parseUcpAgentProfile("agent/1.0")).toBeNull()
    expect(parseUcpAgentProfile(undefined)).toBeNull()
  })
})

describe("resolveUcpVersion", () => {
  it("serves the current version without a fetch when UCP-Agent has no profile", async () => {
    const fetcher: AgentProfileFetcher = { lookup: async () => { throw new Error("must not fetch") } }
    const resolution = await resolveUcpVersion(lenient, "agent/1.0", fetcher)
    expect(resolution).toMatchObject({ version: "2026-04-08", outcome: "none" })
    expect(resolution.rejection).toBeUndefined()
  })

  it.each([
    ["unreachable", null, "unreachable"],
    ["undeclared", JSON.stringify({ ucp: {} }), "undeclared"],
    ["malformed", profileBody("latest"), "undeclared"],
    ["not JSON", "<html>", "undeclared"],
    ["unknown date", profileBody("2027-01-01"), "unknown"],
  ])("falls back to the current version when the profile is %s (lenient)", async (_label, body, outcome) => {
    const resolution = await resolveUcpVersion(lenient, AGENT, fixtureFetcher(body))
    expect(resolution).toMatchObject({ version: "2026-04-08", outcome, host: "agent.example" })
    expect(resolution.rejection).toBeUndefined()
  })

  it("answers 424 agent_profile_unavailable for an unreachable profile (strict)", async () => {
    const resolution = await resolveUcpVersion(strict, AGENT, fixtureFetcher(null))
    expect(resolution.rejection).toEqual({ status: 424, code: "agent_profile_unavailable", content: "Agent profile could not be retrieved." })
  })

  it.each([
    ["undeclared", JSON.stringify({ ucp: {} }), "undeclared"],
    ["unknown date", profileBody("2027-01-01"), "2027-01-01"],
  ])("answers 422 version_unsupported for an %s profile (strict)", async (_label, body, requested) => {
    const resolution = await resolveUcpVersion(strict, AGENT, fixtureFetcher(body))
    expect(resolution.rejection).toEqual({
      status: 422,
      code: "version_unsupported",
      content: `Version ${requested} is not supported. This business implements versions 2026-04-08, 2026-08-25, 2026-01-23.`,
    })
  })

  it.each([lenient, strict])("answers 422 for a known version the store disabled", async () => {
    const resolution = await resolveUcpVersion(withoutLegacy, AGENT, fixtureFetcher(profileBody("2026-01-23")))
    expect(resolution.outcome).toBe("disabled")
    expect(resolution.rejection).toEqual({
      status: 422,
      code: "version_unsupported",
      content: "Version 2026-01-23 is not supported. This business implements versions 2026-04-08, 2026-08-25.",
    })
  })

  it.each(["2026-04-08", "2026-08-25", "2026-01-23"])("serves the declared enabled version %s", async (version) => {
    const resolution = await resolveUcpVersion(lenient, AGENT, fixtureFetcher(profileBody(version)))
    expect(resolution).toMatchObject({ version, outcome: "matched", declared: version })
    expect(resolution.wire.version).toBe(version)
  })

  it("renders the 422 body in the wire shape of the current version", async () => {
    const resolution = await resolveUcpVersion(withoutLegacy, AGENT, fixtureFetcher(profileBody("2026-01-23")))
    expect(resolution.wire.version).toBe("2026-04-08")
    expect(resolution.wire.error({ code: resolution.rejection!.code, content: resolution.rejection!.content })).toEqual({
      ucp: { version: "2026-04-08", status: "error" },
      messages: [{ type: "error", code: "version_unsupported", content: resolution.rejection!.content, severity: "unrecoverable" }],
    })
  })

  it("reads a recorded agent profile body", async () => {
    const body = readFileSync(join(__dirname, "..", "__fixtures__", "ucp", "2026-08-25", "profile.json"), "utf8")
    const resolution = await resolveUcpVersion(lenient, AGENT, fixtureFetcher(body))
    expect(resolution).toMatchObject({ version: "2026-08-25", outcome: "matched" })
  })
})
