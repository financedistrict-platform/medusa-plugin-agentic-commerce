import { describe, expect, it } from "vitest"
import { inspect, format } from "node:util"
import { CREDENTIAL_HANDOFF_KEY, Redacted, markSettlementResume, withCredentialHandoff } from "../lib/credential-handoff"
import { agentPaymentCredential } from "../lib/agent-payment-credential"
import { credentialSha256 } from "../lib/credential-digest"
import { currentHandoff, handedCredential } from "./helpers/credential-handoff"

const SECRET = Buffer.from(JSON.stringify({ x402Version: 2, paymentPayload: { payload: { signature: `0x${"ef".repeat(65)}` } } })).toString("base64")

describe("a redacted credential", () => {
  it("serializes, prints and formats as [redacted]", () => {
    const secret = new Redacted(SECRET)

    expect(JSON.stringify(secret)).toBe('"[redacted]"')
    expect(JSON.stringify({ credential: secret })).toBe('{"credential":"[redacted]"}')
    expect(String(secret)).toBe("[redacted]")
    expect(`${secret}`).toBe("[redacted]")
    expect(inspect(secret)).toBe("[redacted]")
    expect(inspect({ nested: { secret } }, { depth: 5 })).not.toContain(SECRET)
    expect(format("%s %o %j", secret, secret, secret)).not.toContain(SECRET)
    expect(Object.keys(secret)).toEqual([])
  })

  it("gives the raw value only to an explicit reveal", () => {
    expect(new Redacted(SECRET).reveal()).toBe(SECRET)
  })
})

describe("the credential parsed once by the complete routes", () => {
  it("keeps the raw value redacted next to its digest and signed summary", () => {
    const parsed = agentPaymentCredential(SECRET)

    expect(parsed.credential_sha256).toBe(credentialSha256(SECRET))
    expect(parsed.signed_summary).toBeNull()
    expect(parsed.secret.reveal()).toBe(SECRET)
    expect(JSON.stringify(parsed)).not.toContain(SECRET)
    expect(inspect(parsed, { depth: 5 })).not.toContain(SECRET)
  })
})

describe("the request-scoped credential handoff", () => {
  it("is shared through a global symbol so the payment provider package can read it", () => {
    expect(CREDENTIAL_HANDOFF_KEY).toBe(Symbol.for("fd.agentic.prism.credential"))
  })

  it("exposes the credential only inside the scope it was run with", async () => {
    expect(handedCredential()).toBeNull()

    const inside = await withCredentialHandoff(new Redacted(SECRET), async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      await new Promise((resolve) => setImmediate(resolve))
      return handedCredential()
    })

    expect(inside).toBe(SECRET)
    expect(handedCredential()).toBeNull()
  })

  it("keeps concurrent requests apart", async () => {
    const read = (value: string, delay: number) =>
      withCredentialHandoff(new Redacted(value), async () => {
        await new Promise((resolve) => setTimeout(resolve, delay))
        return handedCredential()
      })

    expect(await Promise.all([read("first", 5), read("second", 1)])).toEqual(["first", "second"])
  })

  it("starts without a resume and records the resume decision of the current request only", async () => {
    markSettlementResume(true)

    const flags = await withCredentialHandoff(new Redacted(SECRET), async () => {
      const before = currentHandoff()?.settlementResume
      markSettlementResume(true)
      return { before, after: currentHandoff()?.settlementResume }
    })

    expect(flags).toEqual({ before: false, after: true })
    expect(await withCredentialHandoff(new Redacted(SECRET), async () => currentHandoff()?.settlementResume)).toBe(false)
  })

  it("serializes the scope without the credential", async () => {
    const serialized = await withCredentialHandoff(new Redacted(SECRET), async () => JSON.stringify(currentHandoff()))

    expect(serialized).toBe('{"credential":"[redacted]","settlementResume":false}')
  })
})
