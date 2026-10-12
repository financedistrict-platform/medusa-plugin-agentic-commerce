import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const createRun = vi.hoisted(() => vi.fn())
const updateRun = vi.hoisted(() => vi.fn())

vi.mock("../workflows/create-checkout-session", () => ({ default: () => ({ run: createRun }) }))
vi.mock("../workflows/update-checkout-session", () => ({ default: () => ({ run: updateRun }) }))

import { POST as ucpCartCreate } from "../api/ucp/carts/route"
import { PUT as ucpCartUpdate } from "../api/ucp/carts/[id]/route"
import { POST as ucpCheckoutCreate } from "../api/ucp/checkout-sessions/route"
import { PUT as ucpCheckoutUpdate } from "../api/ucp/checkout-sessions/[id]/route"
import { POST as acpCheckoutCreate } from "../api/acp/checkout_sessions/route"
import { POST as acpCheckoutUpdate } from "../api/acp/checkout_sessions/[id]/route"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"

type Handler = (req: any, res: any) => Promise<void>

const ucpBody = { line_items: [{ item: { id: "variant_nope" }, quantity: 1 }] }
const acpBody = { line_items: [{ id: "variant_nope", quantity: 1 }], currency: "usd", capabilities: {} }

const routes: [string, Handler, "ucp" | "acp", "create" | "update", unknown][] = [
  ["UCP cart create", ucpCartCreate, "ucp", "create", ucpBody],
  ["UCP cart update", ucpCartUpdate, "ucp", "update", ucpBody],
  ["UCP checkout create", ucpCheckoutCreate, "ucp", "create", ucpBody],
  ["UCP checkout update", ucpCheckoutUpdate, "ucp", "update", ucpBody],
  ["ACP checkout create", acpCheckoutCreate, "acp", "create", acpBody],
  ["ACP checkout update", acpCheckoutUpdate, "acp", "update", acpBody],
]

function invoke(handler: Handler, protocol: "ucp" | "acp", body: unknown) {
  const { service } = createStoreService({ version: "2026-04-08" })
  const req: any = {
    ...createRequest({ agenticCommerce: service }, { id: "cart_1" }),
    headers: { host: "store.test", authorization: "Bearer store-key", "ucp-agent": 'agent/1.0; profile="https://agent.example/profile.json"' },
    validatedBody: body,
  }
  const res: any = createResponse()
  return handler(req, res).then(() => ({ res, protocol }))
}

function failWith(run: typeof createRun, error: unknown) {
  run.mockReset()
  run.mockRejectedValue(error)
}

const serialized = (type: string, message: string) => ({ type, message, name: "MedusaError" })

function codeOf(res: any, protocol: "ucp" | "acp"): string {
  return protocol === "ucp" ? res.body.messages[0].code : res.body.code
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(routes)("%s", (_name, handler, protocol, kind, body) => {
  const run = kind === "create" ? createRun : updateRun

  it.each([
    ["an unknown variant", serialized("invalid_data", "Variants variant_nope do not exist or belong to a product that is not published"), 400, "invalid_data"],
    ["a quantity beyond stock", serialized("not_allowed", "Some variant does not have the required inventory"), 422, "not_allowed"],
    ["a missing record", serialized("not_found", "Cart cart_1 not found"), 404, "not_found"],
  ])("answers %s with a client error", async (_label, error, status, code) => {
    failWith(run, error)
    const { res } = await invoke(handler, protocol, body)

    expect(res.statusCode).toBe(status)
    expect(codeOf(res, protocol)).toBe(code)
  })

  it("answers an unexpected error with 500 internal_error without its message", async () => {
    failWith(run, new TypeError("Cannot read properties of undefined (reading 'calculated_amount')"))
    const { res } = await invoke(handler, protocol, body)

    expect(res.statusCode).toBe(500)
    expect(codeOf(res, protocol)).toBe("internal_error")
    expect(JSON.stringify(res.body)).not.toContain("calculated_amount")
  })
})
