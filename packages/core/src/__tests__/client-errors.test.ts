import { describe, it, expect, vi, afterEach } from "vitest"
import { MedusaError } from "@medusajs/framework/utils"
import { clientFailureOf, isAlreadyCompleted, respondAcpFailure, respondUcpFailure } from "../lib/client-errors"
import { assertCurrencySupported } from "../workflows/steps/validate-currency"
import { createRequest, createResponse, createStoreService } from "./helpers/render-wire"

const UNKNOWN_VARIANT = "Variants variant_nope do not exist or belong to a product that is not published"
const OUT_OF_STOCK = "Some variant does not have the required inventory"

const serialized = (type: string, message: string) => ({ type, message, name: "MedusaError" })

function ucpRequest() {
  const { service } = createStoreService({ version: "2026-04-08" })
  return createRequest({ agenticCommerce: service }) as any
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("clientFailureOf", () => {
  it.each([
    ["an unknown variant", MedusaError.Types.INVALID_DATA, UNKNOWN_VARIANT, 400, "invalid_data"],
    ["a quantity beyond stock", MedusaError.Types.NOT_ALLOWED, OUT_OF_STOCK, 422, "not_allowed"],
    ["a missing record", MedusaError.Types.NOT_FOUND, "Cart cart_x not found", 404, "not_found"],
  ])("maps %s to a client status with a stable code", (_label, type, message, status, code) => {
    expect(clientFailureOf(new MedusaError(type, message))).toEqual({ status, code, message })
  })

  it("reads errors that lost their class when the workflow engine serialized them", () => {
    expect(clientFailureOf(serialized("invalid_data", UNKNOWN_VARIANT))).toEqual({
      status: 400,
      code: "invalid_data",
      message: UNKNOWN_VARIANT,
    })
  })

  it.each([
    ["a plain TypeError", new TypeError("Cannot read properties of undefined (reading 'calculated_amount')")],
    ["a database error", new MedusaError(MedusaError.Types.DB_ERROR, "connection refused")],
    ["an unexpected state", new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "boom")],
    ["a thrown string", "boom"],
    ["nothing", undefined],
  ])("does not treat %s as a client error", (_label, error) => {
    expect(clientFailureOf(error)).toBeNull()
  })
})

describe("isAlreadyCompleted", () => {
  it("recognises the duplicate error of a completed checkout", () => {
    expect(isAlreadyCompleted(serialized("duplicate_error", "Checkout session has already been completed"))).toBe(true)
    expect(isAlreadyCompleted(new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "x"))).toBe(true)
  })

  it("ignores other errors", () => {
    expect(isAlreadyCompleted(new MedusaError(MedusaError.Types.NOT_ALLOWED, "x"))).toBe(false)
    expect(isAlreadyCompleted(new Error("x"))).toBe(false)
  })
})

describe("respondUcpFailure", () => {
  it.each([
    ["unknown variant", serialized("invalid_data", UNKNOWN_VARIANT), 400, "invalid_data", UNKNOWN_VARIANT],
    ["quantity beyond stock", serialized("not_allowed", OUT_OF_STOCK), 422, "not_allowed", OUT_OF_STOCK],
    ["missing record", serialized("not_found", "Cart cart_x not found"), 404, "not_found", "Cart cart_x not found"],
  ])("answers %s with a recoverable client error", (_label, error, status, code, content) => {
    const res = createResponse() as any
    respondUcpFailure(ucpRequest(), res, error)

    expect(res.statusCode).toBe(status)
    expect(res.body).toMatchObject({
      ucp: { status: "error" },
      messages: [{ type: "error", code, content, severity: "recoverable" }],
    })
  })

  it("keeps the country error of a region mismatch", () => {
    const res = createResponse() as any
    respondUcpFailure(ucpRequest(), res, serialized("invalid_data", "Country with code fr is not within region Americas"))

    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({
      messages: [{ code: "country_not_supported", severity: "recoverable", path: "$.shipping_address.address_country" }],
    })
  })

  it("answers an unexpected error with 500 internal_error and never leaks its message", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const res = createResponse() as any
    respondUcpFailure(ucpRequest(), res, new TypeError("select * from secret_table failed at 10.0.0.5"))

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ messages: [{ code: "internal_error", content: "Internal error" }] })
    expect(JSON.stringify(res.body)).not.toContain("secret_table")
    expect(log).toHaveBeenCalledWith(expect.stringContaining("secret_table"))
  })
})

describe("respondAcpFailure", () => {
  it.each([
    ["unknown variant", serialized("invalid_data", UNKNOWN_VARIANT), 400, "invalid_data"],
    ["quantity beyond stock", serialized("not_allowed", OUT_OF_STOCK), 422, "not_allowed"],
    ["missing record", serialized("not_found", "Cart cart_x not found"), 404, "not_found"],
  ])("answers %s with an invalid_request error", (_label, error, status, code) => {
    const res = createResponse() as any
    respondAcpFailure(res, error)

    expect(res.statusCode).toBe(status)
    expect(res.body).toMatchObject({ type: "invalid_request", code })
  })

  it("answers an unexpected error with 500 internal_error and never leaks its message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const res = createResponse() as any
    respondAcpFailure(res, new MedusaError(MedusaError.Types.DB_ERROR, "relation cart_secret does not exist"))

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ type: "processing_error", code: "internal_error", message: "Internal error" })
  })
})

describe("assertCurrencySupported", () => {
  const container = (currencies: string[]) => ({
    resolve: () => ({
      graph: async () => ({ data: [{ supported_currencies: currencies.map((currency_code) => ({ currency_code })) }] }),
    }),
  })

  it("accepts a currency the store supports in any case", async () => {
    await expect(assertCurrencySupported(container(["usd", "eur"]), "USD")).resolves.toBeUndefined()
  })

  it("skips the check when the agent sent no currency", async () => {
    await expect(assertCurrencySupported(container([]), undefined)).resolves.toBeUndefined()
  })

  it("rejects an unsupported currency as invalid data and lists the supported ones", async () => {
    const failure = await assertCurrencySupported(container(["usd", "eur"]), "xyz").catch((error) => error)

    expect(clientFailureOf(failure)).toEqual({
      status: 400,
      code: "invalid_data",
      message: 'Currency "xyz" is not supported. Supported currencies: usd, eur.',
    })
  })
})
