import crypto from "crypto"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

const IDEMPOTENCY_TTL = 60 * 60 * 24 // 24 hours in seconds
const PROCESSING_TTL = 60 // 1 minute lock while processing

type CachedResponse = {
  status: "processing" | "completed"
  body_hash: string
  response_status?: number
  response_body?: unknown
  completed_at?: string
}

function hashBody(body: unknown): string {
  const serialized = JSON.stringify(body || {})
  return crypto.createHash("sha256").update(serialized).digest("hex")
}

function cacheKey(path: string, idempotencyKey: string, identity: string): string {
  return `idempotency:${identity}:${path}:${idempotencyKey}`
}

function extractIdentity(req: MedusaRequest): string {
  // Scope by authenticated identity: API key or UCP-Agent header
  const authHeader = req.headers["authorization"]
  if (authHeader) {
    return crypto.createHash("sha256").update(authHeader).digest("hex").slice(0, 16)
  }
  const ucpAgent = req.headers["ucp-agent"] as string
  if (ucpAgent) {
    return crypto.createHash("sha256").update(ucpAgent).digest("hex").slice(0, 16)
  }
  return "anonymous"
}

/**
 * Idempotency middleware for agentic commerce endpoints.
 *
 * - ACP: Idempotency-Key header is REQUIRED on every POST (returns 400 if missing)
 * - UCP: Idempotency-Key header is REQUIRED on POST/PUT (returns 400 if missing)
 *
 * Uses Medusa's cache module (in-memory dev, Redis production) with 24h TTL.
 * Keys are scoped by authenticated identity + request path.
 *
 * Behavior:
 * - New key: mark as "processing", run handler, cache response (skip 5xx)
 * - Duplicate key + same body hash: return cached response with Idempotent-Replayed: true
 * - Duplicate key + different body hash: 422 idempotency_conflict
 * - Duplicate key still processing: 409 with Retry-After: 1
 */
export function createIdempotencyMiddleware(options: {
  required: boolean
  protocol: "acp" | "ucp"
}) {
  return async function idempotencyMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    // Only apply to POST and PUT requests
    if (req.method !== "POST" && req.method !== "PUT") {
      next()
      return
    }

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined

    // If header missing and required, return 400
    if (!idempotencyKey) {
      if (options.required) {
        if (options.protocol === "acp") {
          res.status(400).json({
            type: "invalid_request",
            code: "idempotency_key_required",
            message: "Idempotency-Key header is required for POST requests",
          })
        } else {
          res.status(400).json({
            ucp: { version: "2026-01-11", status: "error" },
            messages: [{
              type: "error",
              code: "idempotency_key_required",
              content: "Idempotency-Key header is required for mutating requests",
              severity: "error",
            }],
          })
        }
        return
      }
      // Not required and not present — skip
      next()
      return
    }

    let cacheModule: any
    try {
      cacheModule = req.scope.resolve(Modules.CACHE)
    } catch {
      // Cache module not available — skip idempotency (dev fallback)
      console.warn("[idempotency] Cache module not available, skipping idempotency check")
      next()
      return
    }

    const identity = extractIdentity(req)
    const key = cacheKey(req.path, idempotencyKey, identity)
    const bodyHash = hashBody(req.body)

    // Check for existing cached response
    const cached: CachedResponse | null = await cacheModule.get(key)

    if (cached) {
      // Body hash mismatch — conflict
      if (cached.body_hash !== bodyHash) {
        if (options.protocol === "acp") {
          res.status(422).json({
            type: "invalid_request",
            code: "idempotency_conflict",
            message: "Idempotency-Key has already been used with a different request body",
          })
        } else {
          res.status(422).json({
            ucp: { version: "2026-01-11", status: "error" },
            messages: [{
              type: "error",
              code: "idempotency_conflict",
              content: "Idempotency-Key has already been used with a different request body",
              severity: "error",
            }],
          })
        }
        return
      }

      // Still processing — retry later
      if (cached.status === "processing") {
        if (options.protocol === "acp") {
          res.status(409).set("Retry-After", "1").json({
            type: "processing_error",
            code: "idempotency_in_flight",
            message: "A request with this Idempotency-Key is currently being processed",
          })
        } else {
          res.status(409).set("Retry-After", "1").json({
            ucp: { version: "2026-01-11", status: "error" },
            messages: [{
              type: "error",
              code: "idempotency_in_flight",
              content: "A request with this Idempotency-Key is currently being processed",
              severity: "error",
            }],
          })
        }
        return
      }

      // Completed — replay cached response
      if (cached.status === "completed" && cached.response_body) {
        res
          .status(cached.response_status || 200)
          .set("Idempotent-Replayed", "true")
          .set("Idempotency-Key", idempotencyKey)
          .json(cached.response_body)
        return
      }
    }

    // Mark as processing
    const processingEntry: CachedResponse = {
      status: "processing",
      body_hash: bodyHash,
    }
    await cacheModule.set(key, processingEntry, PROCESSING_TTL)

    // Intercept res.json to cache the response (skip 5xx)
    const originalJson = res.json.bind(res)
    res.json = function (body: unknown) {
      // Only cache successful responses (non-5xx)
      if (res.statusCode < 500) {
        const completedEntry: CachedResponse = {
          status: "completed",
          body_hash: bodyHash,
          response_status: res.statusCode,
          response_body: body,
          completed_at: new Date().toISOString(),
        }

        // Cache asynchronously — don't block response
        cacheModule.set(key, completedEntry, IDEMPOTENCY_TTL).catch((err: Error) => {
          console.error("[idempotency] Failed to cache response:", err.message)
        })
      } else {
        // 5xx: clean up the processing entry so retries work
        cacheModule.invalidate(key).catch(() => {})
      }

      // Set idempotency headers on response
      res.set("Idempotency-Key", idempotencyKey)

      return originalJson(body)
    } as any

    next()
  }
}
