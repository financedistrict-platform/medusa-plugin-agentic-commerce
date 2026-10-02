import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPublicBaseUrl } from "./public-url"
import type { UcpVersionRegistry } from "./ucp-version-registry"
import { unsupportedVersionMessage } from "./ucp-version-resolver"

type DiscoveryService = {
  getUcpRegistry(): UcpVersionRegistry
  getStoreName(): string
  getPaymentHandlerService(): { getUcpDiscoveryHandlers(ucpVersion: string): Promise<Record<string, unknown[]>> }
}

async function renderProfile(req: MedusaRequest, version: string, includeSupported: boolean) {
  const service = req.scope.resolve("agenticCommerce") as DiscoveryService
  const registry = service.getUcpRegistry()
  const publicBaseUrl = getPublicBaseUrl(req)
  const supportedVersions: Record<string, string> = {}
  if (includeSupported) {
    for (const supported of registry.supported) {
      supportedVersions[supported] = `${publicBaseUrl}/.well-known/ucp/${supported}`
    }
  }
  return registry.wire(version).profile({
    requestBaseUrl: `${req.protocol}://${req.get("host")}`,
    publicBaseUrl,
    storeName: service.getStoreName(),
    handlers: await service.getPaymentHandlerService().getUcpDiscoveryHandlers(version),
    supportedVersions,
  })
}

export async function sendUcpProfile(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve("agenticCommerce") as DiscoveryService
  res.json(await renderProfile(req, service.getUcpRegistry().current, true))
}

export async function sendUcpVersionProfile(req: MedusaRequest, res: MedusaResponse) {
  const registry = (req.scope.resolve("agenticCommerce") as DiscoveryService).getUcpRegistry()
  const version = String(req.params?.version ?? "")
  if (!registry.isEnabled(version)) {
    res.status(404).json(registry.currentWire().error({
      code: "version_unsupported",
      content: unsupportedVersionMessage(registry, version),
    }))
    return
  }
  res.json(await renderProfile(req, version, false))
}
