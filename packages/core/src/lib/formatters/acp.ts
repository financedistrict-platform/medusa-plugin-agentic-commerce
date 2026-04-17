/**
 * ACP Protocol Formatter (Agentic Commerce Protocol, 2026-01-30)
 *
 * Spec: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
 * Source: spec/2026-01-30/json-schema/schema.agentic_checkout.json
 */

import { medusaToAcpAddress } from "../address-translator"
import { resolveAcpStatus, resolveMissingRequirements, type AcpStatus } from "../status-maps"
import type { FormatterContext } from "./types"
import { toMinor } from "./types"

// =====================================================
// Spec-compliant Messages
// =====================================================
// Per spec schema.agentic_checkout.json message types are: info | warning | error.
// All three require: type, content. Errors additionally require: code, severity.
// severity enum: info | low | medium | high | critical
// content_type: plain | markdown (NOT MIME)
// param: JSONPath to the related field (e.g., $.line_items[0])
//
// Error codes (enum):
//   missing, invalid, out_of_stock, payment_declined, requires_sign_in,
//   requires_3ds, low_stock, quantity_exceeded, coupon_invalid, coupon_expired,
//   minimum_not_met, maximum_exceeded, region_restricted, age_verification_required,
//   approval_required, unsupported, not_found, conflict, rate_limited, expired,
//   intervention_required

type AcpMessageSeverity = "info" | "low" | "medium" | "high" | "critical"

type AcpErrorMessage = {
  type: "error"
  code: string
  content: string
  severity: AcpMessageSeverity
  param?: string
  content_type?: "plain" | "markdown"
}

type AcpWarningMessage = {
  type: "warning"
  code: string
  content: string
  severity: AcpMessageSeverity
  param?: string
  content_type?: "plain" | "markdown"
}

type AcpInfoMessage = {
  type: "info"
  content: string
  severity?: AcpMessageSeverity
  param?: string
  content_type?: "plain" | "markdown"
}

type AcpMessage = AcpErrorMessage | AcpWarningMessage | AcpInfoMessage

function buildAcpCheckoutMessages(ctx: FormatterContext, cart: any, status: AcpStatus): AcpMessage[] {
  const messages: AcpMessage[] = []

  if (status === "completed") {
    messages.push({ type: "info", content: "Checkout completed successfully." })
    return messages
  }

  if (status === "canceled") {
    messages.push({ type: "info", content: "This checkout session has been canceled." })
    return messages
  }

  if (status === "expired") {
    messages.push({
      type: "error",
      code: "expired",
      content: "Checkout session has expired. Create a new session.",
      severity: "high",
    })
    return messages
  }

  const missing = resolveMissingRequirements(cart)

  if (missing.includes("items")) {
    messages.push({
      type: "error",
      code: "missing",
      content: "Add at least one item to the checkout session.",
      severity: "high",
      param: "$.line_items",
    })
  }
  if (missing.includes("email")) {
    messages.push({
      type: "error",
      code: "missing",
      content: "Provide buyer.email via POST /checkout_sessions/{id}.",
      severity: "high",
      param: "$.buyer.email",
    })
  }
  if (missing.includes("shipping_address")) {
    messages.push({
      type: "error",
      code: "missing",
      content: "Provide fulfillment_details.address via POST /checkout_sessions/{id}.",
      severity: "high",
      param: "$.fulfillment_details.address",
    })
  }

  if (status === "ready_for_payment") {
    messages.push({
      type: "info",
      content: "Checkout is ready. POST /checkout_sessions/{id}/complete with payment_data.",
    })
  } else if (missing.length === 0) {
    messages.push({ type: "info", content: `Checkout session for ${ctx.storeName}.` })
  }

  return messages
}

// =====================================================
// Line Items & Totals
// =====================================================
// Per spec Item (in line_items[].item): { id (req), name, unit_amount }
// Per spec LineItem: { id (req), item (req), quantity (req), totals (req), ... }
// Per spec Total: { type (req: enum), display_text (req), amount (req) }
// Spec total.type enum: items_base_amount, items_discount, subtotal, discount,
//   fulfillment, tax, fee, gift_wrap, tip, store_credit, total

function formatLineItems(items: any[]) {
  return items.map((item: any) => {
    const unitAmount = toMinor(item.unit_price ?? item.raw_unit_price?.value ?? 0)
    return {
      id: item.id,
      item: {
        id: item.variant_id || item.id,
        name: item.title || item.product_title || "",
        unit_amount: unitAmount,
      },
      quantity: item.quantity,
      totals: [
        { type: "items_base_amount", display_text: "Item total", amount: unitAmount * item.quantity },
      ],
    }
  })
}

/**
 * Compute subtotal directly from line items.
 *
 * Medusa's `cart.subtotal` field semantics vary across versions. Per ACP spec,
 * `subtotal` represents items only (pre-shipping, pre-tax). We compute from
 * line items for predictability, with graceful fallbacks.
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
  if (shipping > 0) totals.push({ type: "fulfillment", display_text: "Shipping", amount: shipping })

  const tax = toMinor(cart.tax_total ?? cart.raw_tax_total?.value ?? 0)
  if (tax > 0) totals.push({ type: "tax", display_text: "Tax", amount: tax })

  const discount = toMinor(cart.discount_total ?? cart.raw_discount_total?.value ?? 0)
  // Medusa stores discount as positive; ACP spec has no sign constraint on discount
  // in Total (unlike UCP), but convention across the spec is negative.
  if (discount > 0) totals.push({ type: "discount", display_text: "Discount", amount: -discount })

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
// Per spec CheckoutSession required fields:
//   id, protocol, capabilities, status, currency, line_items,
//   fulfillment_options, totals, messages, links

export function formatAcpCheckoutSession(ctx: FormatterContext, cart: any, baseUrl: string) {
  const currency = (cart.currency_code || "eur").toUpperCase()
  const status = resolveAcpStatus(cart)

  const createdAt = cart.created_at || cart.metadata?.checkout_session_created_at
  const updatedAt = cart.updated_at
  const expiresAt = createdAt
    ? new Date(new Date(createdAt).getTime() + 6 * 60 * 60 * 1000).toISOString()
    : undefined

  const fulfillmentDetails = cart.shipping_address
    ? {
        name: [cart.shipping_address.first_name, cart.shipping_address.last_name]
          .filter(Boolean).join(" ") || undefined,
        email: cart.email || undefined,
        phone_number: cart.shipping_address.phone || undefined,
        address: medusaToAcpAddress(cart.shipping_address),
      }
    : undefined

  const fulfillmentOptions = (cart.shipping_methods || []).map((sm: any) => ({
    type: "shipping" as const,
    id: sm.id,
    title: sm.name || sm.shipping_option?.name || "Standard Shipping",
    totals: [
      {
        type: "fulfillment",
        display_text: sm.name || "Shipping",
        amount: toMinor(sm.amount ?? sm.raw_amount?.value ?? 0),
      },
    ],
  }))

  const buyer = cart.email
    ? {
        email: cart.email,
        ...(cart.shipping_address?.first_name ? { first_name: cart.shipping_address.first_name } : {}),
        ...(cart.shipping_address?.last_name ? { last_name: cart.shipping_address.last_name } : {}),
        ...(cart.shipping_address?.phone ? { phone_number: cart.shipping_address.phone } : {}),
      }
    : undefined

  const session: Record<string, unknown> = {
    id: cart.id,
    protocol: { version: ctx.acpVersion },
    capabilities: {
      payment: {
        handlers: ctx.paymentHandlers.getAcpCheckoutHandlers(cart.metadata),
      },
    },
    status,
    currency,
    line_items: formatLineItems(cart.items || []),
    fulfillment_options: fulfillmentOptions,
    totals: formatTotals(cart),
    messages: buildAcpCheckoutMessages(ctx, cart, status),
    links: [
      { type: "terms_of_use", url: `${ctx.storefrontUrl}/terms` },
      { type: "privacy_policy", url: `${ctx.storefrontUrl}/privacy` },
    ],
  }

  if (buyer) session.buyer = buyer
  if (fulfillmentDetails) session.fulfillment_details = fulfillmentDetails
  if (createdAt) session.created_at = new Date(createdAt).toISOString()
  if (updatedAt) session.updated_at = new Date(updatedAt).toISOString()
  if (expiresAt) session.expires_at = expiresAt

  return session
}

// =====================================================
// Checkout Complete Response
// =====================================================

export function formatAcpCompleteResponse(
  ctx: FormatterContext, cart: any, baseUrl: string, orderId: string | null, cartId: string
) {
  const session = formatAcpCheckoutSession(ctx, cart, baseUrl) as Record<string, unknown>
  // Order object per spec: { id, checkout_session_id, permalink_url (all required),
  //   order_number, status, estimated_delivery, confirmation, support }
  return {
    ...session,
    status: "completed",
    ...(orderId
      ? {
          order: {
            id: orderId,
            checkout_session_id: cartId,
            permalink_url: `${ctx.storefrontUrl}/orders/${orderId}`,
          },
        }
      : {}),
  }
}

// =====================================================
// Order
// =====================================================

export function formatAcpOrder(ctx: FormatterContext, order: any, baseUrl: string) {
  const currency = (order.currency_code || "eur").toUpperCase()

  const lineItems = (order.items || []).map((item: any) => {
    const unitAmount = toMinor(item.unit_price ?? item.raw_unit_price?.value ?? 0)
    return {
      id: item.id,
      item: {
        id: item.variant_id || item.variant?.id || item.id,
        name: item.title || item.product_title || "",
        unit_amount: unitAmount,
      },
      quantity: item.quantity,
      totals: [
        { type: "items_base_amount", display_text: "Item total", amount: unitAmount * item.quantity },
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

  const fulfillmentDetails = order.shipping_address
    ? {
        name: [order.shipping_address.first_name, order.shipping_address.last_name]
          .filter(Boolean).join(" ") || undefined,
        email: order.email || undefined,
        phone_number: order.shipping_address.phone || undefined,
        address: medusaToAcpAddress(order.shipping_address),
      }
    : undefined

  return {
    id: order.id,
    protocol: { version: ctx.acpVersion },
    order_number: order.display_id || null,
    checkout_session_id: order.cart_id || null,
    permalink_url: `${ctx.storefrontUrl}/orders/${order.id}`,
    status: order.status || "confirmed",
    currency,
    line_items: lineItems,
    fulfillment_details: fulfillmentDetails,
    fulfillment_events: fulfillmentEvents,
    totals: formatTotals(order),
    created_at: order.created_at,
    updated_at: order.updated_at,
    messages: [
      { type: "info", content: `Order ${order.display_id || order.id} from ${ctx.storeName}.` },
    ],
    links: [{ type: "self", url: `${baseUrl}/${order.id}` }],
  }
}
