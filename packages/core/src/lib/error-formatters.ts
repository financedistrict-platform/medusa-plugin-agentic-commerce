/**
 * Protocol-specific error response formatters.
 * Each protocol has a different error response schema.
 */

// --- ACP Errors ---
// Spec (schema.agentic_checkout.json error types):
//   invalid_request | request_not_idempotent | processing_error | service_unavailable
// Shape: { type, code, message, param? }

export type AcpErrorType =
  | "invalid_request"
  | "request_not_idempotent"
  | "processing_error"
  | "service_unavailable"

export type AcpErrorResponse = {
  type: AcpErrorType
  code: string
  message: string
  param?: string
}

export function formatAcpError(params: {
  type?: AcpErrorType
  code: string
  message: string
  param?: string
  httpStatus?: number
}): AcpErrorResponse {
  const type = params.type || httpStatusToAcpType(params.httpStatus || 500)
  return {
    type,
    code: params.code,
    message: params.message,
    ...(params.param ? { param: params.param } : {}),
  }
}

export function httpStatusToAcpType(status: number): AcpErrorType {
  if (status >= 400 && status < 500) return "invalid_request"
  if (status === 503) return "service_unavailable"
  return "processing_error"
}

// --- UCP Errors ---
// Spec error_response.json:
//   { ucp: { version, status: "error" }, messages: [message_error, ...] }
// message_error.json required fields: type, code, content, severity
//   severity enum: recoverable | requires_buyer_input | requires_buyer_review | unrecoverable

export type UcpErrorSeverity =
  | "recoverable"
  | "requires_buyer_input"
  | "requires_buyer_review"
  | "unrecoverable"

export type UcpErrorResponse = {
  ucp: {
    version: string
    status: "error"
  }
  messages: {
    type: "error"
    code: string
    content: string
    severity: UcpErrorSeverity
    path?: string
    content_type?: "plain" | "markdown"
  }[]
}

export function formatUcpError(params: {
  ucpVersion: string
  code: string
  content: string
  severity?: UcpErrorSeverity
  path?: string
}): UcpErrorResponse {
  return {
    ucp: {
      version: params.ucpVersion,
      status: "error",
    },
    messages: [
      {
        type: "error",
        code: params.code,
        content: params.content,
        severity: params.severity || "unrecoverable",
        ...(params.path ? { path: params.path } : {}),
      },
    ],
  }
}
