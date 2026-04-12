import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/agentic-commerce/settings
 * Returns current agentic commerce settings from store metadata.
 * Secrets are masked — only preview suffixes are returned.
 *
 * POST /admin/agentic-commerce/settings
 * Updates agentic commerce settings in store metadata and refreshes the service.
 * Only allowlisted keys are accepted.
 */

// Allowlisted setting keys that can be written via POST
const ALLOWED_SETTINGS_KEYS = new Set([
  "ucp_enabled",
  "acp_enabled",
  "store_name",
  "store_description",
  "storefront_url",
  "api_key",
  "signature_key",
])

function maskSecret(value: string | undefined): string | null {
  if (!value) return null
  return value.length > 4
    ? `${"•".repeat(value.length - 4)}${value.slice(-4)}`
    : "••••"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query") as any

  try {
    const { data: [store] } = await query.graph({
      entity: "store",
      fields: ["id", "metadata"],
    })

    const agenticCommerce = req.scope.resolve("agenticCommerce") as any
    const defaults = {
      ucp_enabled: true,
      acp_enabled: true,
      store_name: agenticCommerce.getStoreName(),
      store_description: agenticCommerce.getStoreDescription(),
      storefront_url: agenticCommerce.getStorefrontUrl(),
      api_key: "",
      signature_key: "",
    }

    const settings = {
      ...defaults,
      ...(store?.metadata?.agentic_commerce || {}),
    }

    // Return settings with secrets replaced by masked previews
    const { api_key, signature_key, ...safeSettings } = settings

    const paymentHandlers = agenticCommerce.getPaymentHandlerService()
    const adapterCount = paymentHandlers.getAdapterCount()

    res.json({
      settings: {
        ...safeSettings,
        api_key_preview: maskSecret(api_key),
        signature_key_preview: maskSecret(signature_key),
        has_api_key: !!api_key,
        has_signature_key: !!signature_key,
      },
      store_id: store?.id,
      payment_handlers: {
        count: adapterCount,
        connected: adapterCount > 0,
      },
    })
  } catch {
    res.status(500).json({ message: "Failed to fetch settings" })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query") as any
  const body = req.body as Record<string, unknown>

  try {
    // Only accept allowlisted keys
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_SETTINGS_KEYS.has(key)) {
        sanitized[key] = value
      }
    }

    if (Object.keys(sanitized).length === 0) {
      res.status(400).json({ message: "No valid settings keys provided" })
      return
    }

    // Fetch current store
    const { data: [store] } = await query.graph({
      entity: "store",
      fields: ["id", "metadata"],
    })

    if (!store) {
      res.status(404).json({ message: "Store not found" })
      return
    }

    // Merge sanitized settings with existing
    const existingSettings = store.metadata?.agentic_commerce || {}
    const newSettings = { ...existingSettings, ...sanitized }

    // Update store metadata
    const storeModuleService = req.scope.resolve("store") as any
    await storeModuleService.updateStores(store.id, {
      metadata: {
        ...store.metadata,
        agentic_commerce: newSettings,
      },
    })

    // Force service to refresh settings immediately
    const agenticCommerce = req.scope.resolve("agenticCommerce") as any
    await agenticCommerce.refreshSettings(query)

    // Return success without leaking secrets
    const { api_key, signature_key, ...safeResponse } = newSettings
    res.json({
      settings: {
        ...safeResponse,
        has_api_key: !!api_key,
        has_signature_key: !!signature_key,
      },
    })
  } catch {
    res.status(500).json({ message: "Failed to update settings" })
  }
}
