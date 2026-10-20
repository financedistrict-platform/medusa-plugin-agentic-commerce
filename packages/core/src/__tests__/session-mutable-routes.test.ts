import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const updateRun = vi.hoisted(() => vi.fn())
const cancelRun = vi.hoisted(() => vi.fn())

vi.mock("../workflows/update-checkout-session", () => ({ default: () => ({ run: updateRun }) }))
vi.mock("../workflows/cancel-checkout-session", () => ({ default: () => ({ run: cancelRun }) }))

import { PUT as ucpUpdate } from "../api/ucp/checkout-sessions/[id]/route"
import { POST as ucpCancel } from "../api/ucp/checkout-sessions/[id]/cancel/route"
import { POST as acpUpdate } from "../api/acp/checkout_sessions/[id]/route"
import { POST as acpCancel } from "../api/acp/checkout_sessions/[id]/cancel/route"
import { SessionLockedError } from "../workflows/steps/assert-session-mutable"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"

const CODES = ["session_complete_in_progress", "session_requires_escalation", "session_completed", "session_canceled"] as const

const call = async (route: (req: any, res: any) => Promise<void>) => {
  const { service } = createStoreService({ version: "2026-04-08" })
  const req: any = { ...createRequest({ agenticCommerce: service }, { id: "cart_1" }), validatedBody: {}, body: {} }
  const res: any = createResponse()
  await route(req, res)
  return res
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  updateRun.mockReset()
  cancelRun.mockReset()
})

describe("update and cancel refused while the session cannot change", () => {
  it.each(CODES)("answers 409 %s on a UCP update and cancel", async (code) => {
    updateRun.mockRejectedValue(new SessionLockedError(code))
    cancelRun.mockRejectedValue(new SessionLockedError(code))

    const update = await call(ucpUpdate)
    const cancel = await call(ucpCancel)

    expect(update.statusCode).toBe(409)
    expect(update.body).toMatchObject({ messages: [{ code }] })
    expect(cancel.statusCode).toBe(409)
    expect(cancel.body).toMatchObject({ messages: [{ code }] })
  })

  it.each(CODES)("answers 409 %s on an ACP update and cancel", async (code) => {
    updateRun.mockRejectedValue(new SessionLockedError(code))
    cancelRun.mockRejectedValue(new SessionLockedError(code))

    const update = await call(acpUpdate)
    const cancel = await call(acpCancel)

    expect(update.statusCode).toBe(409)
    expect(update.body).toMatchObject({ code })
    expect(cancel.statusCode).toBe(409)
    expect(cancel.body).toMatchObject({ code })
  })
})
