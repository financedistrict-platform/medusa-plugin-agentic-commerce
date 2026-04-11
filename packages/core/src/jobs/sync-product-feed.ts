import { MedusaContainer } from "@medusajs/framework/types"

/**
 * Scheduled job: syncs the product feed every 15 minutes.
 *
 * For each region/country combination, generates an XML product feed
 * and sends it via the agenticCommerce module service.
 *
 * Currently logs to console — will POST to agent platforms (e.g., OpenAI)
 * when their feed endpoint becomes available.
 */
export default async function syncProductFeed(
  container: MedusaContainer
) {
  const query = container.resolve("query") as any
  const agenticCommerceService = container.resolve("agenticCommerce") as any
  const storefrontUrl = agenticCommerceService.getStorefrontUrl()
  const storeName = agenticCommerceService.getStoreName()

  // Get all regions with countries
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code", "countries.iso_2"],
  })

  for (const region of regions) {
    // Fetch published products with pricing
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id", "title", "description", "handle", "thumbnail", "status",
        "variants.id", "variants.title", "variants.sku", "variants.prices.*",
        "categories.name",
        "images.url",
      ],
      filters: { status: "published" },
    })

    // Build XML items
    const items = products.map((product: any) => {
      const variant = product.variants?.[0]
      const price = variant?.prices?.find(
        (p: any) => p.currency_code === region.currency_code
      ) || variant?.prices?.[0]
      const priceAmount = price ? (price.amount / 100).toFixed(2) : "0.00"
      const currency = price?.currency_code?.toUpperCase() || "EUR"
      const category = product.categories?.[0]?.name || "Merchandise"
      const imageUrl = product.thumbnail || product.images?.[0]?.url || ""

      // Escape XML special characters
      const escXml = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

      return `    <item>
      <title><![CDATA[${product.title || ""}]]></title>
      <link>${escXml(storefrontUrl)}/products/${escXml(product.handle || "")}</link>
      <description><![CDATA[${product.description || ""}]]></description>
      <g:id>${escXml(variant?.id || product.id)}</g:id>
      <g:price>${priceAmount} ${currency}</g:price>
      <g:availability>in stock</g:availability>
      <g:condition>new</g:condition>
      <g:brand>${escXml(storeName)}</g:brand>
      <g:product_type>${escXml(category)}</g:product_type>
      <g:image_link>${escXml(imageUrl)}</g:image_link>
      <g:link>${escXml(storefrontUrl)}/products/${escXml(product.handle || "")}</g:link>
      <enable_search>true</enable_search>
      <enable_checkout>true</enable_checkout>
    </item>`
    })

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${storeName} Product Feed</title>
    <link>${storefrontUrl}</link>
    <description>Product feed for ${storeName}</description>
${items.join("\n")}
  </channel>
</rss>`

    await agenticCommerceService.sendProductFeed(xml, region.id)
  }
}

export const config = {
  name: "sync-product-feed",
  schedule: "*/15 * * * *", // Every 15 minutes
}
