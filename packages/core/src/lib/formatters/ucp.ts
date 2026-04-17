/**
 * UCP Protocol Formatter
 *
 * Transforms Medusa internal objects into UCP-compliant response shapes.
 * Spec: https://github.com/Universal-Commerce-Protocol/ucp
 */

import { medusaToUcpAddress } from "../address-translator"
import { resolveUcpStatus, resolveMissingRequirements, type UcpStatus } from "../status-maps"
import type { FormatterContext } from "./types"
import { toMinor } from "./types"

// =====================================================
// Spec-compliant Messages
// =====================================================
// Per UCP spec `message.json`: messages are oneOf { error, warning, info }.
//   - error:   required [type, code, content, severity]
//              severity: recoverable | requires_buyer_input | requires_buyer_review | unrecoverable
//   - warning: required [type, code, content]
//   - info:    required [type, content]   (code is optional)
// content_type: "plain" | "markdown" (default "plain"). NOT a MIME type.

type UcpErrorMessage = {
  type: "error"
  code: string
  content: string
  severity: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable"
  path?: string
  content_type?: "plain" | "markdown"
}

type UcpWarningMessage = {
  type: "warning"
  code: string
  content: string
  path?: string
  content_type?: "plain" | "markdown"
  presentation?: string
}

type UcpInfoMessage = {
  type: "info"
  content: string
  code?: string
  path?: string
  content_type?: "plain" | "markdown"
}

type UcpMessage = UcpErrorMessage | UcpWarningMessage | UcpInfoMessage

/**
 * Build messages describing the current state of the checkout session.
 *
 * Missing-field errors use severity "recoverable" — the agent can fix them
 * by calling PUT /checkout-sessions/{id}. Per spec, only `requires_*`
 * severities contribute to `status: requires_escalation`.
 */
function buildCheckoutMessages(ctx: FormatterContext, cart: any, status: UcpStatus): UcpMessage[] {
  const messages: UcpMessage[] = []

  if (status === "completed") {
    messages.push({
      type: "info",
      code: "checkout_completed",
      content: "Checkout completed successfully.",
    })
    return messages
  }

  if (status === "canceled") {
    messages.push({
      type: "info",
      code: "checkout_canceled",
      content: "This checkout session has been canceled.",
    })
    return messages
  }

  // Surface missing requirements as recoverable errors with JSONPath hints
  const missing = resolveMissingRequirements(cart)

  if (missing.includes("items")) {
    messages.push({
      type: "error",
      code: "missing_items",
      content: "Checkout session has no line items. Add items via PUT /checkout-sessions/{id}.",
      severity: "recoverable",
      path: "$.line_items",
    })
  }

  if (missing.includes("email")) {
    messages.push({
      type: "error",
      code: "missing_email",
      content: "Buyer email is required. Provide it via PUT /checkout-sessions/{id} with buyer.email.",
      severity: "recoverable",
      path: "$.buyer.email",
    })
  }

  if (missing.includes("shipping_address")) {
    messages.push({
      type: "error",
      code: "missing_shipping_address",
      content: "Shipping address is required. Provide it via PUT /checkout-sessions/{id} with shipping_address.",
      severity: "recoverable",
      path: "$.shipping_address",
    })
  }

  if (status === "ready_for_complete") {
    messages.push({
      type: "info",
      code: "ready_for_complete",
      content: "Checkout is ready. POST /checkout-sessions/{id}/complete with payment.instruments[].",
    })
  } else if (missing.length === 0) {
    messages.push({
      type: "info",
      code: "checkout_in_progress",
      content: `Checkout session for ${ctx.storeName}.`,
    })
  }

  return messages
}

// =====================================================
// UCP Envelope
// =====================================================

function ucpEnvelope(ctx: FormatterContext, includePayment: boolean, cartMetadata?: Record<string, unknown>) {
  const envelope: Record<string, unknown> = {
    version: ctx.ucpVersion,
    status: "success",
    capabilities: {
      "dev.ucp.shopping.catalog.search": [{ version: ctx.ucpVersion }],
      "dev.ucp.shopping.catalog.lookup": [{ version: ctx.ucpVersion }],
      "dev.ucp.shopping.checkout": [{ version: ctx.ucpVersion }],
      "dev.ucp.shopping.cart": [{ version: ctx.ucpVersion }],
      "dev.ucp.shopping.order": [{ version: ctx.ucpVersion }],
    },
  }
  if (includePayment) {
    envelope.payment_handlers = ctx.paymentHandlers.getUcpCheckoutHandlers(cartMetadata)
  }
  return envelope
}

// =====================================================
// Line Items
// =====================================================

function formatLineItems(items: any[], currency: string) {
  return items.map((item: any) => {
    const unitAmount = toMinor(item.unit_price ?? item.raw_unit_price?.value ?? 0)
    return {
      id: item.id,
      item: {
        id: item.variant_id || item.id,
        title: item.title || item.product_title || "",
        price: unitAmount, // spec: amount.json is an integer (minor units)
      },
      quantity: item.quantity,
      totals: [
        { type: "line_total", display_text: "Line total", amount: unitAmount * item.quantity },
      ],
    }
  })
}

// =====================================================
// Totals
// =====================================================
// Spec: totals.json MUST contain exactly one subtotal and one total.
// Discount amounts must be exclusiveMaximum: 0 (strictly negative).
// Other types (subtotal, fulfillment, tax, fee) must be minimum: 0.

/**
 * Compute subtotal directly from line items.
 *
 * Medusa's `cart.subtotal` field semantics vary across versions — in some
 * versions it includes shipping/tax. Per UCP spec (total.json), `subtotal`
 * must represent items only, pre-shipping and pre-tax. The safest source is
 * the line items themselves: sum of unit_price * quantity.
 *
 * Falls back to `cart.item_subtotal` (Medusa v2 field that's items-only) and
 * then `cart.subtotal` if items aren't loaded.
 */
function computeSubtotal(cart: any): number {
  const items = cart.items || []
  if (items.length > 0) {
    const sum = items.reduce((acc: number, item: any) => {
      const unit = item.unit_price ?? item.raw_unit_price?.value ?? 0
      return acc + unit * (item.quantity || 0)
    }, 0)
    return toMinor(sum)
  }
  return toMinor(
    cart.item_subtotal ?? cart.item_total ?? cart.subtotal ?? cart.raw_subtotal?.value ?? 0
  )
}

function formatTotals(cart: any) {
  const totals: { type: string; display_text: string; amount: number }[] = []

  totals.push({
    type: "subtotal",
    display_text: "Subtotal",
    amount: computeSubtotal(cart),
  })

  const shipping = toMinor(cart.shipping_total ?? cart.raw_shipping_total?.value ?? 0)
  if (shipping > 0) {
    totals.push({ type: "fulfillment", display_text: "Shipping", amount: shipping })
  }

  const tax = toMinor(cart.tax_total ?? cart.raw_tax_total?.value ?? 0)
  if (tax > 0) {
    totals.push({ type: "tax", display_text: "Tax", amount: tax })
  }

  const discount = toMinor(cart.discount_total ?? cart.raw_discount_total?.value ?? 0)
  if (discount > 0) {
    // Medusa stores discount as a positive number; spec requires negative.
    totals.push({ type: "discount", display_text: "Discount", amount: -discount })
  }

  totals.push({
    type: "total",
    display_text: "Total",
    amount: toMinor(cart.total ?? cart.raw_total?.value ?? 0),
  })

  return totals
}

// =====================================================
// Checkout Session
// =====================================================

export function formatUcpCheckoutSession(ctx: FormatterContext, cart: any, baseUrl: string) {
  const currency = (cart.currency_code || "eur").toUpperCase()
  const status = resolveUcpStatus(cart)

  // Spec expires_at: default TTL is 6 hours from creation
  const createdAt = cart.created_at || cart.metadata?.checkout_session_created_at
  const expiresAt = createdAt
    ? new Date(new Date(createdAt).getTime() + 6 * 60 * 60 * 1000).toISOString()
    : undefined

  const session: Record<string, unknown> = {
    ucp: ucpEnvelope(ctx, true, cart.metadata),
    id: cart.id,
    status,
    currency,
    line_items: formatLineItems(cart.items || [], currency),
    totals: formatTotals(cart),
    messages: buildCheckoutMessages(ctx, cart, status),
    links: [
      { type: "terms_of_service", url: `${ctx.storefrontUrl}/terms` },
      { type: "privacy_policy", url: `${ctx.storefrontUrl}/privacy` },
    ],
  }

  // Optional buyer per spec buyer.json (first_name, last_name, email, phone_number)
  if (cart.email || cart.shipping_address?.first_name || cart.shipping_address?.phone) {
    session.buyer = {
      ...(cart.shipping_address?.first_name ? { first_name: cart.shipping_address.first_name } : {}),
      ...(cart.shipping_address?.last_name ? { last_name: cart.shipping_address.last_name } : {}),
      ...(cart.email ? { email: cart.email } : {}),
      ...(cart.shipping_address?.phone ? { phone_number: cart.shipping_address.phone } : {}),
    }
  }

  // Optional shipping_address per spec postal_address.json (additionalProperties: true
  // on checkout lets us attach it; fulfillment options surfaced in a non-standard field
  // is avoided — agents set address via PUT, then session transitions)
  if (cart.shipping_address) {
    session.shipping_address = medusaToUcpAddress(cart.shipping_address)
  }

  if (expiresAt) session.expires_at = expiresAt

  return session
}

// =====================================================
// Cart
// =====================================================

export function formatUcpCart(ctx: FormatterContext, cart: any, baseUrl: string) {
  const currency = (cart.currency_code || "eur").toUpperCase()

  const createdAt = cart.created_at
  const expiresAt = createdAt
    ? new Date(new Date(createdAt).getTime() + 6 * 60 * 60 * 1000).toISOString()
    : undefined

  const result: Record<string, unknown> = {
    ucp: ucpEnvelope(ctx, false),
    id: cart.id,
    currency,
    line_items: formatLineItems(cart.items || [], currency),
    totals: formatTotals(cart),
    messages: [],
    links: [
      { type: "terms_of_service", url: `${ctx.storefrontUrl}/terms` },
      { type: "privacy_policy", url: `${ctx.storefrontUrl}/privacy` },
    ],
  }

  if (cart.email) {
    result.buyer = { email: cart.email }
  }
  if (cart.shipping_address) {
    result.shipping_address = medusaToUcpAddress(cart.shipping_address)
  }
  if (expiresAt) result.expires_at = expiresAt

  return result
}

// =====================================================
// Product
// =====================================================

export function formatUcpProduct(product: any) {
  const variants = (product.variants || []).map((v: any) => {
    const price = v.prices?.[0] || v.calculated_price || null
    const priceAmount = price
      ? Math.round((price.amount ?? price.calculated_amount ?? 0) * 100)
      : null
    const priceCurrency = price?.currency_code || "eur"

    return {
      id: v.id,
      title: v.title || "",
      sku: v.sku || null,
      price: priceAmount != null
        ? { amount: priceAmount, currency: priceCurrency }
        : null,
      availability: {
        available: v.inventory_quantity != null ? v.inventory_quantity > 0 : true,
        status: v.inventory_quantity != null
          ? v.inventory_quantity > 0 ? "in_stock" : "out_of_stock"
          : "in_stock",
      },
    }
  })

  const variantPrices = variants
    .map((v: any) => v.price?.amount)
    .filter((p: any) => p != null)
  const priceRange = variantPrices.length > 0
    ? {
        min: { amount: Math.min(...variantPrices), currency: variants[0]?.price?.currency || "eur" },
        max: { amount: Math.max(...variantPrices), currency: variants[0]?.price?.currency || "eur" },
      }
    : null

  const media = (product.images || []).map((img: any) => ({
    url: img.url,
    type: "image",
  }))

  if (product.thumbnail) {
    media.unshift({ url: product.thumbnail, type: "image" })
  }

  return {
    id: product.id,
    title: product.title || "",
    description: product.description || "",
    handle: product.handle || "",
    categories: (product.categories || []).map((c: any) => c.name),
    price_range: priceRange,
    variants,
    media,
  }
}

// =====================================================
// Order
// =====================================================

export function formatUcpOrder(ctx: FormatterContext, order: any, baseUrl: string) {
  const currency = (order.currency_code || "eur").toUpperCase()

  const lineItems = (order.items || []).map((item: any) => {
    const unitAmount = toMinor(item.unit_price ?? item.raw_unit_price?.value ?? 0)
    return {
      id: item.id,
      item: {
        id: item.variant_id || item.variant?.id || item.id,
        title: item.title || item.product_title || "",
        price: unitAmount,
      },
      quantity: item.quantity,
      totals: [
        { type: "line_total", display_text: "Line total", amount: unitAmount * item.quantity },
      ],
    }
  })

  const fulfillmentEvents = (order.fulfillments || []).map((f: any) => ({
    type: f.shipped_at ? "shipped" : "created",
    timestamp: f.shipped_at || f.created_at,
    tracking_number: f.labels?.[0]?.tracking_number || null,
    carrier: f.provider?.id || null,
    items: (f.items || []).map((i: any) => ({
      product_id: i.line_item?.product_id || null,
      quantity: i.quantity,
    })),
  }))

  const result: Record<string, unknown> = {
    ucp: ucpEnvelope(ctx, false),
    id: order.id,
    display_id: order.display_id || null,
    checkout_id: order.cart_id || null,
    permalink_url: `${ctx.storefrontUrl}/orders/${order.id}`,
    status: order.status || "pending",
    currency,
    line_items: lineItems,
    totals: formatTotals(order),
    fulfillment_status: order.fulfillment_status || "not_fulfilled",
    fulfillment_events: fulfillmentEvents,
    created_at: order.created_at,
    updated_at: order.updated_at,
    links: [
      { type: "self", url: `${baseUrl}/${order.id}` },
    ],
  }

  if (order.email) result.buyer = { email: order.email }
  if (order.shipping_address) result.shipping_address = medusaToUcpAddress(order.shipping_address)

  return result
}
