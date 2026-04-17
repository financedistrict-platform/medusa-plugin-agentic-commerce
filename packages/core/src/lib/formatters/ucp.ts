/**
 * UCP Protocol Formatter
 *
 * Transforms Medusa internal objects into UCP-compliant response shapes.
 * Spec: https://developers.fd.xyz/ucp
 */

import { medusaToUcpAddress } from "../address-translator"
import { resolveUcpStatus, resolveMissingRequirements } from "../status-maps"
import type { FormatterContext } from "./types"
import { toMinor } from "./types"

// =====================================================
// Dynamic Messages
// =====================================================

type UcpMessage = {
  type: "info" | "warning" | "error" | "required_action"
  code: string
  content: string
  severity: "info" | "warning" | "error"
}

/**
 * Build messages guiding the agent on what to do next.
 * Emits required_action entries for missing fields so agents can recover.
 */
function buildCheckoutMessages(ctx: FormatterContext, cart: any, status: string): UcpMessage[] {
  const messages: UcpMessage[] = []

  if (status === "completed") {
    messages.push({
      type: "info",
      code: "checkout_completed",
      content: "Checkout completed successfully.",
      severity: "info",
    })
    return messages
  }

  if (status === "canceled") {
    messages.push({
      type: "info",
      code: "checkout_canceled",
      content: "This checkout session has been canceled.",
      severity: "info",
    })
    return messages
  }

  // In-progress: surface what's still needed
  const missing = resolveMissingRequirements(cart)

  if (missing.includes("items")) {
    messages.push({
      type: "required_action",
      code: "missing_items",
      content: "Add at least one item to the checkout session.",
      severity: "error",
    })
  }

  if (missing.includes("email")) {
    messages.push({
      type: "required_action",
      code: "missing_email",
      content: "Provide a buyer email via PUT /checkout-sessions/{id} with { buyer: { email } }.",
      severity: "error",
    })
  }

  if (missing.includes("shipping_address")) {
    messages.push({
      type: "required_action",
      code: "missing_shipping_address",
      content: "Provide a shipping address via PUT /checkout-sessions/{id} with { shipping_address }.",
      severity: "error",
    })
  }

  if (status === "ready_for_complete") {
    messages.push({
      type: "info",
      code: "ready_for_complete",
      content: "Checkout is ready. POST /checkout-sessions/{id}/complete with payment.instruments[].",
      severity: "info",
    })
  } else if (missing.length === 0) {
    // No missing requirements but status is incomplete — something else blocks progress
    messages.push({
      type: "info",
      code: "checkout_in_progress",
      content: `Checkout session for ${ctx.storeName}.`,
      severity: "info",
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
        price: { amount: unitAmount, currency },
      },
      quantity: item.quantity,
      totals: [
        { type: "line_total", amount: unitAmount * item.quantity },
      ],
    }
  })
}

// =====================================================
// Checkout Session
// =====================================================

export function formatUcpCheckoutSession(ctx: FormatterContext, cart: any, baseUrl: string) {
  const currency = cart.currency_code || "eur"
  const status = resolveUcpStatus(cart)

  const totals = [
    { type: "subtotal", amount: toMinor(cart.subtotal ?? cart.raw_subtotal?.value ?? 0) },
    { type: "fulfillment", amount: toMinor(cart.shipping_total ?? cart.raw_shipping_total?.value ?? 0) },
    { type: "tax", amount: toMinor(cart.tax_total ?? cart.raw_tax_total?.value ?? 0) },
    { type: "discount", amount: toMinor(cart.discount_total ?? cart.raw_discount_total?.value ?? 0) },
    { type: "total", amount: toMinor(cart.total ?? cart.raw_total?.value ?? 0) },
  ]

  const fulfillment = cart.shipping_address
    ? {
        address: medusaToUcpAddress(cart.shipping_address),
        options: (cart.shipping_methods || []).map((sm: any) => ({
          id: sm.id,
          type: "shipping",
          title: sm.name || "Standard Shipping",
          amount: toMinor(sm.amount ?? sm.raw_amount?.value ?? 0),
        })),
      }
    : null

  return {
    ucp: ucpEnvelope(ctx, true, cart.metadata),
    id: cart.id,
    status,
    currency,
    email: cart.email || null,
    line_items: formatLineItems(cart.items || [], currency),
    totals,
    fulfillment,
    messages: buildCheckoutMessages(ctx, cart, status),
    links: [
      { type: "terms_of_service", url: `${ctx.storefrontUrl}/terms` },
      { type: "privacy_policy", url: `${ctx.storefrontUrl}/privacy` },
    ],
  }
}

// =====================================================
// Cart
// =====================================================

export function formatUcpCart(ctx: FormatterContext, cart: any, baseUrl: string) {
  const currency = cart.currency_code || "eur"

  const totals = [
    { type: "subtotal", amount: toMinor(cart.subtotal ?? cart.raw_subtotal?.value ?? 0) },
    { type: "fulfillment", amount: toMinor(cart.shipping_total ?? cart.raw_shipping_total?.value ?? 0) },
    { type: "tax", amount: toMinor(cart.tax_total ?? cart.raw_tax_total?.value ?? 0) },
    { type: "total", amount: toMinor(cart.total ?? cart.raw_total?.value ?? 0) },
  ]

  return {
    ucp: ucpEnvelope(ctx, false),
    id: cart.id,
    currency,
    email: cart.email || null,
    line_items: formatLineItems(cart.items || [], currency),
    totals,
    shipping_address: cart.shipping_address
      ? medusaToUcpAddress(cart.shipping_address)
      : null,
    links: {
      self: `${baseUrl}/${cart.id}`,
      checkout: baseUrl.replace("/carts", "/checkout-sessions"),
    },
  }
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
  const currency = order.currency_code || "eur"

  const lineItems = (order.items || []).map((item: any) => {
    const unitAmount = toMinor(item.unit_price ?? item.raw_unit_price?.value ?? 0)
    return {
      id: item.id,
      item: {
        id: item.variant_id || item.variant?.id || item.id,
        title: item.title || item.product_title || "",
        price: { amount: unitAmount, currency },
      },
      quantity: item.quantity,
      totals: [
        { type: "line_total", amount: unitAmount * item.quantity },
      ],
    }
  })

  const totals = [
    { type: "subtotal", amount: toMinor(order.subtotal ?? order.raw_subtotal?.value ?? 0) },
    { type: "fulfillment", amount: toMinor(order.shipping_total ?? order.raw_shipping_total?.value ?? 0) },
    { type: "tax", amount: toMinor(order.tax_total ?? order.raw_tax_total?.value ?? 0) },
    { type: "discount", amount: toMinor(order.discount_total ?? order.raw_discount_total?.value ?? 0) },
    { type: "total", amount: toMinor(order.total ?? order.raw_total?.value ?? 0) },
  ]

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

  const fulfillment = order.shipping_address
    ? {
        status: order.fulfillment_status || "not_fulfilled",
        address: medusaToUcpAddress(order.shipping_address),
        events: fulfillmentEvents,
      }
    : null

  return {
    ucp: ucpEnvelope(ctx, false),
    id: order.id,
    display_id: order.display_id || null,
    checkout_id: order.cart_id || null,
    permalink_url: `${ctx.storefrontUrl}/orders/${order.id}`,
    status: order.status || "pending",
    currency,
    email: order.email || null,
    line_items: lineItems,
    fulfillment,
    totals,
    created_at: order.created_at,
    updated_at: order.updated_at,
    links: [
      { type: "self", url: `${baseUrl}/${order.id}` },
    ],
  }
}
