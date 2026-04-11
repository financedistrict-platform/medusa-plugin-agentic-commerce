import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CreateAcpCheckoutSessionSchema,
  UpdateAcpCheckoutSessionSchema,
  CompleteAcpCheckoutSessionSchema,
  CreateUcpCheckoutSessionSchema,
  UpdateUcpCheckoutSessionSchema,
  CompleteUcpCheckoutSessionSchema,
  CreateUcpCartSchema,
  UpdateUcpCartSchema,
  CatalogSearchSchema,
  CatalogLookupSchema,
} from "./validation-schemas"
import { createIdempotencyMiddleware } from "./middleware/idempotency"
import { formatAcpError } from "../lib/error-formatters"
import { formatUcpError } from "../lib/error-formatters"

// Supported ACP API versions
const SUPPORTED_ACP_VERSIONS = ["2026-01-30"]
const UCP_VERSION = "2026-01-11"

// --- ACP Auth Middleware ---
// Validates Bearer token + API-Version header + optional HMAC signature

async function validateAcpRequest(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  // Validate Bearer token
  const apiKey = req.headers["authorization"]?.replace("Bearer ", "").trim()
  if (!apiKey) {
    res.status(401).json(formatAcpError({
      type: "invalid_request",
      code: "unauthorized",
      message: "Missing API key in Authorization header",
      httpStatus: 401,
    }))
    return
  }

  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  if (!agenticCommerceService.validateApiKey(apiKey)) {
    res.status(401).json(formatAcpError({
      type: "invalid_request",
      code: "unauthorized",
      message: "Invalid API key",
      httpStatus: 401,
    }))
    return
  }

  // Validate API-Version header (required by ACP spec)
  const apiVersion = req.headers["api-version"] as string | undefined
  if (!apiVersion) {
    res.status(400).json(formatAcpError({
      code: "missing_api_version",
      message: "API-Version header is required for ACP requests",
      httpStatus: 400,
    }))
    return
  }

  if (!SUPPORTED_ACP_VERSIONS.includes(apiVersion)) {
    res.status(400).json(formatAcpError({
      code: "unsupported_api_version",
      message: `Unsupported API-Version: ${apiVersion}. Supported versions: ${SUPPORTED_ACP_VERSIONS.join(", ")}`,
      httpStatus: 400,
    }))
    return
  }

  // Optional HMAC signature verification for write operations
  if (req.method !== "GET" && req.headers["signature"]) {
    const signature = req.headers["signature"] as string
    const body = JSON.stringify(req.body || {})
    if (!agenticCommerceService.verifySignature(body, signature)) {
      res.status(403).json(formatAcpError({
        code: "invalid_signature",
        message: "Invalid request signature",
        httpStatus: 403,
      }))
      return
    }
  }

  next()
}

// --- ACP Request-Id Middleware ---
// Echoes client's Request-Id if provided, otherwise generates new

async function acpRequestId(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const clientRequestId = req.headers["request-id"] as string | undefined
  res.set("Request-Id", clientRequestId || crypto.randomUUID())
  next()
}

// --- UCP Auth Middleware ---
// Requires UCP-Agent header, validates Request-Id, optionally validates Bearer token

async function validateUcpRequest(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const ucpAgent = req.headers["ucp-agent"] as string | undefined

  if (!ucpAgent) {
    res.status(400).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "missing_ucp_agent",
      content: "Missing UCP-Agent header for platform identification",
    }))
    return
  }

  // Validate Request-Id header (required by UCP spec)
  const requestId = req.headers["request-id"] as string | undefined
  if (!requestId) {
    res.status(400).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "missing_request_id",
      content: "Request-Id header is required for UCP requests",
    }))
    return
  }

  // Echo Request-Id back
  res.set("Request-Id", requestId)

  // If a Bearer token is provided, validate it
  const authHeader = req.headers["authorization"]
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "").trim()
    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    if (!agenticCommerceService.validateApiKey(token)) {
      res.status(401).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "unauthorized",
        content: "Invalid Bearer token",
      }))
      return
    }
  }

  next()
}

export default defineMiddlewares({
  routes: [
    // --- .well-known rewrite ---
    // Medusa build skips directories starting with "." so we serve
    // from /well-known/* and rewrite the standard /.well-known/* path.
    {
      matcher: "/.well-known/*",
      middlewares: [
        (req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) => {
          req.url = req.url.replace("/.well-known/", "/well-known/")
          next()
        },
      ],
    },

    // --- ACP Auth + Request-Id ---
    {
      matcher: "/acp/checkout_sessions*",
      middlewares: [validateAcpRequest, acpRequestId],
    },
    {
      matcher: "/acp/orders*",
      middlewares: [validateAcpRequest, acpRequestId],
    },
    {
      matcher: "/acp/product-feed*",
      middlewares: [validateAcpRequest, acpRequestId],
    },

    // --- ACP Idempotency (required on all POSTs) ---
    {
      matcher: "/acp/checkout_sessions*",
      method: "POST",
      middlewares: [createIdempotencyMiddleware({ required: true, protocol: "acp" })],
    },

    // --- ACP Zod Validation ---
    {
      matcher: "/acp/checkout_sessions",
      method: "POST",
      middlewares: [validateAndTransformBody(CreateAcpCheckoutSessionSchema)],
    },
    {
      matcher: "/acp/checkout_sessions/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(UpdateAcpCheckoutSessionSchema)],
    },
    {
      matcher: "/acp/checkout_sessions/:id/complete",
      method: "POST",
      middlewares: [validateAndTransformBody(CompleteAcpCheckoutSessionSchema)],
    },

    // --- UCP Auth ---
    {
      matcher: "/ucp/catalog/*",
      middlewares: [validateUcpRequest],
    },
    {
      matcher: "/ucp/checkout-sessions*",
      middlewares: [validateUcpRequest],
    },
    {
      matcher: "/ucp/carts*",
      middlewares: [validateUcpRequest],
    },
    {
      matcher: "/ucp/orders*",
      middlewares: [validateUcpRequest],
    },

    // --- UCP Idempotency (required on POST/PUT) ---
    {
      matcher: "/ucp/checkout-sessions*",
      method: "POST",
      middlewares: [createIdempotencyMiddleware({ required: true, protocol: "ucp" })],
    },
    {
      matcher: "/ucp/checkout-sessions*",
      method: "PUT",
      middlewares: [createIdempotencyMiddleware({ required: true, protocol: "ucp" })],
    },
    {
      matcher: "/ucp/carts*",
      method: "POST",
      middlewares: [createIdempotencyMiddleware({ required: true, protocol: "ucp" })],
    },
    {
      matcher: "/ucp/carts*",
      method: "PUT",
      middlewares: [createIdempotencyMiddleware({ required: true, protocol: "ucp" })],
    },

    // --- UCP Zod Validation ---
    {
      matcher: "/ucp/checkout-sessions",
      method: "POST",
      middlewares: [validateAndTransformBody(CreateUcpCheckoutSessionSchema)],
    },
    {
      matcher: "/ucp/checkout-sessions/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(UpdateUcpCheckoutSessionSchema)],
    },
    {
      matcher: "/ucp/checkout-sessions/:id/complete",
      method: "POST",
      middlewares: [validateAndTransformBody(CompleteUcpCheckoutSessionSchema)],
    },
    {
      matcher: "/ucp/carts",
      method: "POST",
      middlewares: [validateAndTransformBody(CreateUcpCartSchema)],
    },
    {
      matcher: "/ucp/carts/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(UpdateUcpCartSchema)],
    },
    {
      matcher: "/ucp/catalog/search",
      method: "POST",
      middlewares: [validateAndTransformBody(CatalogSearchSchema)],
    },
    {
      matcher: "/ucp/catalog/lookup",
      method: "POST",
      middlewares: [validateAndTransformBody(CatalogLookupSchema)],
    },
  ],
})
