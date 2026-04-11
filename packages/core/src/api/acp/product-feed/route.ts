import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = req.scope.resolve("query")
    const agenticCommerceService = req.scope.resolve("agenticCommerce") as any
    const storefrontUrl = agenticCommerceService.getStorefrontUrl()
    const storeName = agenticCommerceService.getStoreName()

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

    const items = products.map((product: any) => {
      const variant = product.variants?.[0]
      const price = variant?.prices?.find((p: any) => p.currency_code === "eur") || variant?.prices?.[0]
      const priceAmount = price ? (price.amount / 100).toFixed(2) : "0.00"
      const currency = price?.currency_code?.toUpperCase() || "EUR"
      const category = product.categories?.[0]?.name || "Merchandise"
      const imageUrl = product.thumbnail || product.images?.[0]?.url || ""

      return `    <item>
      <title><![CDATA[${product.title}]]></title>
      <link>${storefrontUrl}/products/${product.handle}</link>
      <description><![CDATA[${product.description || ""}]]></description>
      <g:id>${product.id}</g:id>
      <g:price>${priceAmount} ${currency}</g:price>
      <g:availability>in stock</g:availability>
      <g:condition>new</g:condition>
      <g:brand>Finance District</g:brand>
      <g:product_type>${category}</g:product_type>
      <g:image_link>${imageUrl}</g:image_link>
      <g:link>${storefrontUrl}/products/${product.handle}</g:link>
    </item>`
    })

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${storeName} Product Feed</title>
    <link>${storefrontUrl}</link>
    <description>Product feed for ${storeName} - Finance District branded merchandise</description>
${items.join("\n")}
  </channel>
</rss>`

    res.set("Content-Type", "application/xml")
    res.send(xml)
  } catch (error: any) {
    res.status(500).json({ error: "Internal Server Error", message: error.message })
  }
}
