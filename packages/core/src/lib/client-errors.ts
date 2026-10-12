import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaResponse } from "@medusajs/framework/http"
import { formatAcpError, httpStatusToAcpType } from "./error-formatters"
import { ucpErrorFor, type UcpRequestLike } from "./ucp-version"

const CLIENT_STATUS_BY_TYPE: Record<string, number> = {
  [MedusaError.Types.NOT_FOUND]: 404,
  [MedusaError.Types.INVALID_DATA]: 400,
  [MedusaError.Types.NOT_ALLOWED]: 422,
}

const COUNTRY_OUTSIDE_REGION = /Country with code .* is not within region/i
const INTERNAL_ERROR_MESSAGE = "Internal error"

export type ClientFailure = {
  status: number
  code: string
  message: string
}

export function errorTypeOf(error: unknown): string | undefined {
  const type = (error as { type?: unknown } | null | undefined)?.type
  return typeof type === "string" ? type : undefined
}

function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return typeof message === "string" ? message : ""
}

export function isAlreadyCompleted(error: unknown): boolean {
  return errorTypeOf(error) === MedusaError.Types.DUPLICATE_ERROR
}

export function clientFailureOf(error: unknown): ClientFailure | null {
  const type = errorTypeOf(error)
  const status = type ? CLIENT_STATUS_BY_TYPE[type] : undefined
  if (!type || !status) return null
  return { status, code: type, message: messageOf(error) }
}

function logUnexpected(error: unknown): void {
  console.error(`[agentic-commerce] unexpected error: ${messageOf(error) || String(error)}`)
}

export function respondUcpFailure(req: UcpRequestLike, res: MedusaResponse, error: unknown): void {
  const message = messageOf(error)

  if (COUNTRY_OUTSIDE_REGION.test(message)) {
    res.status(400).json(ucpErrorFor(req, {
      code: "country_not_supported",
      content: message,
      severity: "recoverable",
      path: "$.shipping_address.address_country",
    }))
    return
  }

  const failure = clientFailureOf(error)
  if (failure) {
    res.status(failure.status).json(ucpErrorFor(req, {
      code: failure.code,
      content: failure.message,
      severity: "recoverable",
    }))
    return
  }

  logUnexpected(error)
  res.status(500).json(ucpErrorFor(req, {
    code: "internal_error",
    content: INTERNAL_ERROR_MESSAGE,
  }))
}

export function respondAcpFailure(res: MedusaResponse, error: unknown): void {
  const failure = clientFailureOf(error)
  if (failure) {
    res.status(failure.status).json(formatAcpError({
      type: httpStatusToAcpType(failure.status),
      code: failure.code,
      message: failure.message,
    }))
    return
  }

  logUnexpected(error)
  res.status(500).json(formatAcpError({
    type: httpStatusToAcpType(500),
    code: "internal_error",
    message: INTERNAL_ERROR_MESSAGE,
  }))
}
