import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CreateAcpCheckoutSessionSchema,
  UpdateAcpCheckoutSessionSchema,
  CompleteAcpCheckoutSessionSchema,
  CreateUcpCheckoutSessionSchema,
  UpdateUcpCheckoutSessionSchema,
  CreateUcpCartSchema,
  UpdateUcpCartSchema,
  CatalogSearchSchema,
  CatalogLookupSchema,
} from "./validation-schemas"
import { createIdempotencyMiddleware } from "./middleware/idempotency"
import { formatAcpError } from "../lib/error-formatters"
import { computeSessionFingerprint, verifySessionOwnership } from "../lib/session-ownership"
import { ucpErrorFor, type UcpRequestLike } from "../lib/ucp-version"
import type { UcpCapability } from "../lib/ucp-wire/types"
import type { UcpVersionRegistry } from "../lib/ucp-version-registry"
import {
  applyUcpSessionPin,
  isFallbackOutcome,
  resolveUcpVersion,
  type UcpResolution,
} from "../lib/ucp-version-resolver"
import { createAgentProfileFetcher } from "../lib/agent-profile-fetcher"
import { sendUcpProfile, sendUcpVersionProfile } from "../lib/ucp-discovery"

// Supported ACP API versions
const SUPPORTED_ACP_VERSIONS = ["2026-01-30"]

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
    res.status(400).json(ucpErrorFor(req, {
      code: "missing_ucp_agent",
      content: "Missing UCP-Agent header for platform identification",
    }))
    return
  }

  // Validate Request-Id header (required by UCP spec)
  const requestId = req.headers["request-id"] as string | undefined
  if (!requestId) {
    res.status(400).json(ucpErrorFor(req, {
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
      res.status(401).json(ucpErrorFor(req, {
        code: "unauthorized",
        content: "Invalid Bearer token",
      }))
      return
    }
  }

  next()
}

const agentProfileFetcher = createAgentProfileFetcher()

const CAPABILITY_PATHS: [string, UcpCapability][] = [
  ["/ucp/carts", "cart"],
  ["/ucp/catalog", "catalog"],
  ["/ucp/checkout-sessions", "checkout"],
  ["/ucp/orders", "order"],
]

function ucpRegistry(req: MedusaRequest): UcpVersionRegistry {
  return (req.scope.resolve("agenticCommerce") as { getUcpRegistry(): UcpVersionRegistry }).getUcpRegistry()
}

function logUcpResolution(req: MedusaRequest, resolution: UcpResolution) {
  if (!resolution.rejection && !isFallbackOutcome(resolution.outcome)) return
  const logger = req.scope.resolve("logger") as { warn(message: string): void }
  logger.warn(JSON.stringify({
    ucp_profile_resolution: resolution.outcome,
    served: resolution.rejection ? null : resolution.version,
    host: resolution.host ?? null,
    ...(resolution.outcome === "redirected" ? { location: resolution.location ?? null } : {}),
  }))
}

function rejectUcpResolution(req: MedusaRequest, res: MedusaResponse, resolution: UcpResolution): boolean {
  if (!resolution.rejection) return false
  res.status(resolution.rejection.status).json(resolution.wire.error({
    code: resolution.rejection.code,
    content: resolution.rejection.content,
  }))
  return true
}

async function resolveUcpVersionMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const resolution = await resolveUcpVersion(
    ucpRegistry(req),
    req.headers["ucp-agent"] as string | undefined,
    agentProfileFetcher,
  )
  logUcpResolution(req, resolution)
  if (rejectUcpResolution(req, res, resolution)) return

  ;(req as UcpRequestLike).ucp = resolution
  const capability = CAPABILITY_PATHS.find(([prefix]) => req.path.startsWith(prefix))?.[1]
  if (capability && !resolution.wire.supports(capability)) {
    res.status(404).json(resolution.wire.error({
      code: "capabilities_incompatible",
      content: `Capability ${capability} is not available in UCP version ${resolution.version}.`,
    }))
    return
  }
  next()
}

async function enforceSessionVersionPin(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const resolution = (req as UcpRequestLike).ucp as UcpResolution | undefined
  const { id } = req.params
  if (!resolution || !id) {
    next()
    return
  }

  const query = req.scope.resolve("query") as any
  const { data: [cart] } = await query.graph({
    entity: "cart",
    fields: ["id", "metadata"],
    filters: { id },
  })
  const pinned = applyUcpSessionPin(ucpRegistry(req), resolution, cart?.metadata?.ucp_version)
  if (pinned.version !== resolution.version || pinned.rejection) logUcpResolution(req, pinned)
  if (rejectUcpResolution(req, res, pinned)) return

  ;(req as UcpRequestLike).ucp = pinned
  next()
}

// --- Session Ownership Middleware ---
// Verifies that the caller's fingerprint matches the session creator's fingerprint.
// Prevents agent A from modifying agent B's checkout session.

async function verifySessionOwner(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const { id } = req.params
  if (!id) {
    next()
    return
  }

  try {
    const query = req.scope.resolve("query") as any
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: ["id", "metadata"],
      filters: { id },
    })

    if (!cart) {
      // Let the route handler deal with 404
      next()
      return
    }

    const fingerprint = computeSessionFingerprint(req)
    if (!verifySessionOwnership(cart.metadata, fingerprint)) {
      // Determine protocol from path for error formatting
      const isAcp = req.path.startsWith("/acp")
      if (isAcp) {
        res.status(403).json(formatAcpError({
          type: "invalid_request",
          code: "session_ownership_mismatch",
          message: "You do not have permission to modify this checkout session",
          httpStatus: 403,
        }))
      } else {
        res.status(403).json(ucpErrorFor(req, {
          code: "session_ownership_mismatch",
          content: "You do not have permission to modify this checkout session",
        }))
      }
      return
    }
  } catch {
    // If we can't verify ownership, allow the request through
    // (the route handler will deal with invalid IDs)
  }

  next()
}

// --- Adapter Resolution Middleware ---
// Resolves payment handler adapters from the request-scoped container.
// Must run before any route that accesses payment handlers.
// Module-scoped containers can't see other modules; the request scope can.

async function resolvePaymentAdapters(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    agenticCommerceService.resolveAdapters(req.scope)
  } catch {
    // Silently skip — service may not be configured
  }
  next()
}

// --- .well-known route handlers ---
// Medusa's file-based routing ignores directories starting with "." so the
// actual route files live at src/api/well-known/. These method-specific
// middleware entries register proper Express routes at the standard
// /.well-known/ paths that proxy to the real handlers.

async function wellKnownUcpHandler(req: MedusaRequest, res: MedusaResponse) {
  await sendUcpProfile(req, res)
}

async function wellKnownUcpVersionHandler(req: MedusaRequest, res: MedusaResponse) {
  await sendUcpVersionProfile(req, res)
}

async function wellKnownAcpHandler(req: MedusaRequest, res: MedusaResponse) {
  const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
  const paymentHandlers = agenticCommerceService.getPaymentHandlerService()
  const acpVersion = agenticCommerceService.getAcpVersion()
  const handlers = await paymentHandlers.getAcpDiscoveryHandlers(agenticCommerceService.getUcpVersion())
  const baseUrl = `${req.protocol}://${req.get("host")}`

  res.json({
    protocol: {
      name: "acp",
      version: acpVersion,
      supported_versions: [acpVersion],
    },
    api_base_url: `${baseUrl}/acp`,
    transports: ["rest"],
    capabilities: {
      services: ["checkout", "orders"],
      payment: { handlers },
      supported_currencies: ["eur"],
      supported_locales: ["en"],
    },
  })
}

export default defineMiddlewares({
  routes: [
    // --- .well-known route aliases ---
    // Registered as app.get() routes so they work at the standard RFC 8615 path.
    // resolvePaymentAdapters runs first to ensure adapters are available.
    {
      matcher: "/.well-known/ucp",
      method: "GET",
      middlewares: [resolvePaymentAdapters, wellKnownUcpHandler],
    },
    {
      matcher: "/.well-known/ucp/:version",
      method: "GET",
      middlewares: [resolvePaymentAdapters, wellKnownUcpVersionHandler],
    },
    {
      matcher: "/.well-known/acp.json",
      method: "GET",
      middlewares: [resolvePaymentAdapters, wellKnownAcpHandler],
    },

    // --- ACP Auth + Adapter Resolution + Request-Id ---
    {
      matcher: "/acp/checkout_sessions*",
      middlewares: [validateAcpRequest, resolvePaymentAdapters, acpRequestId],
    },
    {
      matcher: "/acp/orders*",
      middlewares: [validateAcpRequest, resolvePaymentAdapters, acpRequestId],
    },
    {
      matcher: "/acp/product-feed*",
      middlewares: [validateAcpRequest, resolvePaymentAdapters, acpRequestId],
    },

    // --- ACP Session Ownership ---
    {
      matcher: "/acp/checkout_sessions/:id",
      middlewares: [verifySessionOwner],
    },
    {
      matcher: "/acp/checkout_sessions/:id/complete",
      middlewares: [verifySessionOwner],
    },
    {
      matcher: "/acp/checkout_sessions/:id/cancel",
      middlewares: [verifySessionOwner],
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

    // --- UCP Auth + Adapter Resolution ---
    {
      matcher: "/ucp/catalog/*",
      middlewares: [validateUcpRequest, resolveUcpVersionMiddleware, resolvePaymentAdapters],
    },
    {
      matcher: "/ucp/checkout-sessions*",
      middlewares: [validateUcpRequest, resolveUcpVersionMiddleware, resolvePaymentAdapters],
    },
    {
      matcher: "/ucp/carts*",
      middlewares: [validateUcpRequest, resolveUcpVersionMiddleware, resolvePaymentAdapters],
    },
    {
      matcher: "/ucp/orders*",
      middlewares: [validateUcpRequest, resolveUcpVersionMiddleware, resolvePaymentAdapters],
    },

    // --- UCP Session Ownership ---
    {
      matcher: "/ucp/checkout-sessions/:id",
      middlewares: [verifySessionOwner, enforceSessionVersionPin],
    },
    {
      matcher: "/ucp/checkout-sessions/:id/complete",
      middlewares: [verifySessionOwner, enforceSessionVersionPin],
    },
    {
      matcher: "/ucp/checkout-sessions/:id/cancel",
      middlewares: [verifySessionOwner, enforceSessionVersionPin],
    },
    {
      matcher: "/ucp/carts/:id",
      middlewares: [verifySessionOwner, enforceSessionVersionPin],
    },
    {
      matcher: "/ucp/carts/:id/cancel",
      middlewares: [verifySessionOwner, enforceSessionVersionPin],
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
