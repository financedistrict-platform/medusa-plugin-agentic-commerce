/**
 * Resolve the public-facing base URL for API responses.
 *
 * On ECS, req.protocol + req.get("host") returns the internal service
 * discovery address (e.g. fd-merch-medusa-test.fd-services.local:9000).
 * We need the public storefront URL instead.
 */
export function getPublicBaseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  return process.env.STOREFRONT_URL || `${req.protocol}://${req.get("host")}`
}
