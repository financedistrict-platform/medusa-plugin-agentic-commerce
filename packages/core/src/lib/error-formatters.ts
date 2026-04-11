/**
 * Protocol-specific error response formatters.
 * Each protocol has a different error response schema.
 */

// --- ACP Errors ---
// Spec: { type: "invalid_request"|"processing_error"|"service_unavailable", code, message, param? }

export type AcpErrorType = "invalid_request" | "processing_error" | "service_unavailable"

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
// Spec: { ucp: { version, status: "error" }, messages: [{ type: "error", code, content, severity }] }

export type UcpErrorResponse = {
  ucp: {
    version: string
    status: "error"
  }
  messages: {
    type: "error"
    code: string
    content: string
    severity: string
  }[]
}

export function formatUcpError(params: {
  ucpVersion: string
  code: string
  content: string
  severity?: string
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
        severity: params.severity || "error",
      },
    ],
  }
}
