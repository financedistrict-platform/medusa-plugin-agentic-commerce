import { describe, it, expect, vi } from "vitest"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"

const createRun = vi.hoisted(() => vi.fn(async () => ({ result: { id: "cart_1" } })))

vi.mock("../workflows/create-checkout-session", () => ({
  default: () => ({ run: createRun }),
}))

import middlewares from "../api/middlewares"
import { POST as cartCreate } from "../api/ucp/carts/route"

function cartRequest(outcome: string) {
  const { service } = createStoreService({ version: "2026-04-08", supported: ["2026-08-25", "2026-01-23"] })
  const query = { graph: vi.fn(async () => ({ data: [{ id: "cart_1", items: [], metadata: {} }] })) }
  createRun.mockClear()
  return {
    ...createRequest({ agenticCommerce: service, query }),
    validatedBody: { line_items: [] },
    ucp: { version: "2026-01-23", outcome },
  } as any
}

describe("UCP cart session pin", () => {
  it("stores the UCP version on a cart created by a matched profile", async () => {
    await cartCreate(cartRequest("matched"), createResponse() as any)
    expect(createRun).toHaveBeenCalledWith({ input: expect.objectContaining({ ucp_version: "2026-01-23" }) })
  })

  it("does not pin a cart created on a fallback", async () => {
    await cartCreate(cartRequest("unreachable"), createResponse() as any)
    expect(createRun).toHaveBeenCalledWith({ input: expect.objectContaining({ ucp_version: undefined }) })
  })

  it.each(["/ucp/carts/:id", "/ucp/carts/:id/cancel"])("enforces the session pin on %s", (matcher) => {
    const route = (middlewares as any).routes.find((r: any) => r.matcher === matcher)
    expect(route.middlewares.map((m: any) => m.name)).toContain("enforceSessionVersionPin")
  })
})
