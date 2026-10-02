import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import middlewares from "../api/middlewares"
import { GET as wellKnownRouteGet } from "../api/well-known/ucp/route"
import { createRequest, createResponse, createStoreService, runRoute } from "./helpers/render-wire"

const service = (supported?: string[]) => createStoreService({ version: "2026-04-08", supported }).service

describe("/.well-known/ucp/:version", () => {
  it("is registered as a middleware matcher next to /.well-known/ucp", () => {
    const matchers = (middlewares as any).routes.map((r: { matcher: string }) => r.matcher)
    expect(matchers.indexOf("/.well-known/ucp/:version")).toBe(matchers.indexOf("/.well-known/ucp") + 1)
    expect(existsSync(join(__dirname, "..", "api", "well-known", "ucp", "[version]", "route.ts"))).toBe(false)
  })

  it.each(["2026-08-25", "2026-01-23", "2026-04-08"])("serves the %s leaf profile without supported_versions", async (version) => {
    const res = await runRoute("/.well-known/ucp/:version", createRequest({ agenticCommerce: service(["2026-08-25", "2026-01-23"]) }, { version }))
    const profile = res.body as { ucp: Record<string, unknown> }
    expect(res.statusCode).toBe(200)
    expect(profile.ucp.version).toBe(version)
    expect(profile.ucp).not.toHaveProperty("supported_versions")
  })

  it("answers 404 for a version the store disabled", async () => {
    const res = await runRoute("/.well-known/ucp/:version", createRequest({ agenticCommerce: service(["2026-08-25"]) }, { version: "2026-01-23" }))
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({
      ucp: { version: "2026-04-08", status: "error" },
      messages: [{
        type: "error",
        code: "version_unsupported",
        content: "Version 2026-01-23 is not supported. This business implements versions 2026-04-08, 2026-08-25.",
        severity: "unrecoverable",
      }],
    })
  })

  it("answers 404 for an unknown version", async () => {
    const res = await runRoute("/.well-known/ucp/:version", createRequest({ agenticCommerce: service() }, { version: "latest" }))
    expect(res.statusCode).toBe(404)
  })
})

describe("/.well-known/ucp", () => {
  it("lists every supported version with its leaf profile URL", async () => {
    const res = await runRoute("/.well-known/ucp", createRequest({ agenticCommerce: service(["2026-08-25", "2026-01-23"]) }))
    expect((res.body as any).ucp.supported_versions).toEqual({
      "2026-08-25": "https://store.test/.well-known/ucp/2026-08-25",
      "2026-01-23": "https://store.test/.well-known/ucp/2026-01-23",
    })
  })

  it("serves the same document from the file route at /well-known/ucp", async () => {
    const services = { agenticCommerce: service(["2026-08-25", "2026-01-23"]) }
    const viaMiddleware = await runRoute("/.well-known/ucp", createRequest(services))
    const res = createResponse()
    await wellKnownRouteGet(createRequest(services) as any, res as any)
    expect(res.body).toEqual(viaMiddleware.body)
  })

  it("matches the 0.1.12 bytes with an empty supported list", async () => {
    const res = await runRoute("/.well-known/ucp", createRequest({ agenticCommerce: service([]) }))
    const golden = readFileSync(join(__dirname, "..", "__fixtures__", "ucp", "2026-04-08", "profile.json"), "utf8")
    expect(JSON.stringify(res.body, null, 2)).toBe(golden)
  })
})
