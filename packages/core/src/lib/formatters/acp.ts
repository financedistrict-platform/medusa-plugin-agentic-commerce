/**
 * ACP Protocol Formatter
 *
 * Transforms Medusa internal objects into ACP-compliant response shapes.
 * Spec: https://developers.fd.xyz/acp
 */

import { medusaToAcpAddress } from "../address-translator"
import { resolveAcpStatus } from "../status-maps"
import type { FormatterContext } from "./types"
import { toMinor } from "./types"

// =====================================================
// Checkout Session
// =====================================================

export function formatAcpCheckoutSession(ctx: FormatterContext, cart: any, baseUrl: string) {
  const currency = cart.currency_code || "eur"
  const status = resolveAcpStatus(cart)

  const lineItems = (cart.items || []).map((item: any) => {
    const unitAmount = toMinor(item.unit_price ?? item.raw_unit_price?.value ?? 0)
    return {
      id: item.id,
      item: {
        id: item.variant_id || item.id,
        title: item.title || item.product_title || "",
        price: { amount: unitAmount, currency },
      },
      quantity: item.quantity,
      name: item.title || item.product_title || "",
      unit_amount: unitAmount,
      availability_status: "available",
      totals: [
        { type: "line_total", amount: unitAmount * item.quantity },
      ],
    }
  })

  const totals = [
    { type: "subtotal", display_text: "Subtotal", amount: toMinor(cart.subtotal ?? cart.raw_subtotal?.value ?? 0) },
    { type: "fulfillment", display_text: "Shipping", amount: toMinor(cart.shipping_total ?? cart.raw_shipping_total?.value ?? 0) },
    { type: "tax", display_text: "Tax", amount: toMinor(cart.tax_total ?? cart.raw_tax_total?.value ?? 0) },
    { type: "discount", display_text: "Discount", amount: toMinor(cart.discount_total ?? cart.raw_discount_total?.value ?? 0) },
    { type: "total", display_text: "Total", amount: toMinor(cart.total ?? cart.raw_total?.value ?? 0) },
  ]

  const fulfillmentDetails = cart.shipping_address
    ? {
        name: [cart.shipping_address.first_name, cart.shipping_address.last_name].filter(Boolean).join(" ") || undefined,
        email: cart.email || undefined,
        phone_number: cart.shipping_address.phone || undefined,
        address: medusaToAcpAddress(cart.shipping_address),
      }
    : null

  const fulfillmentOptions = (cart.shipping_methods || []).map((sm: any) => ({
    id: sm.id,
    type: "shipping",
    title: sm.name || sm.shipping_option?.name || "Standard Shipping",
    totals: [
      { type: "fulfillment", amount: toMinor(sm.amount ?? sm.raw_amount?.value ?? 0) },
    ],
  }))

  return {
    id: cart.id,
    status,
    currency,
    capabilities: {
      payment: {
        handlers: ctx.paymentHandlers.getAcpCheckoutHandlers(cart.metadata),
      },
    },
    line_items: lineItems,
    totals,
    fulfillment_details: fulfillmentDetails,
    fulfillment_options: fulfillmentOptions,
    messages: [
      { type: "info" as const, content_type: "text/plain", content: `Checkout session for ${ctx.storeName}` },
    ],
    links: [
      { type: "terms_of_use", url: `${ctx.storefrontUrl}/terms` },
      { type: "privacy_policy", url: `${ctx.storefrontUrl}/privacy` },
    ],
  }
}

// =====================================================
// Checkout Complete Response
// =====================================================

export function formatAcpCompleteResponse(
  ctx: FormatterContext, cart: any, baseUrl: string, orderId: string | null, cartId: string
) {
  const session = formatAcpCheckoutSession(ctx, cart, baseUrl)
  return {
    ...session,
    status: "completed",
    order: orderId
      ? {
          id: orderId,
          checkout_session_id: cartId,
          permalink_url: `${ctx.storefrontUrl}/orders/${orderId}`,
        }
      : null,
  }
}

// =====================================================
// Order
// =====================================================

export function formatAcpOrder(ctx: FormatterContext, order: any, baseUrl: string) {
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
      name: item.title || item.product_title || "",
      unit_amount: unitAmount,
      totals: [
        { type: "line_total", amount: unitAmount * item.quantity },
      ],
    }
  })

  const totals = [
    { type: "subtotal", display_text: "Subtotal", amount: toMinor(order.subtotal ?? order.raw_subtotal?.value ?? 0) },
    { type: "fulfillment", display_text: "Shipping", amount: toMinor(order.shipping_total ?? order.raw_shipping_total?.value ?? 0) },
    { type: "tax", display_text: "Tax", amount: toMinor(order.tax_total ?? order.raw_tax_total?.value ?? 0) },
    { type: "discount", display_text: "Discount", amount: toMinor(order.discount_total ?? order.raw_discount_total?.value ?? 0) },
    { type: "total", display_text: "Total", amount: toMinor(order.total ?? order.raw_total?.value ?? 0) },
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

  const fulfillmentDetails = order.shipping_address
    ? {
        name: [order.shipping_address.first_name, order.shipping_address.last_name].filter(Boolean).join(" ") || undefined,
        email: order.email || undefined,
        address: medusaToAcpAddress(order.shipping_address),
        status: order.fulfillment_status || "not_fulfilled",
        events: fulfillmentEvents,
      }
    : null

  return {
    id: order.id,
    display_id: order.display_id || null,
    checkout_session_id: order.cart_id || null,
    permalink_url: `${ctx.storefrontUrl}/orders/${order.id}`,
    status: order.status || "pending",
    currency,
    email: order.email || null,
    line_items: lineItems,
    fulfillment_details: fulfillmentDetails,
    totals,
    created_at: order.created_at,
    updated_at: order.updated_at,
    messages: [
      { type: "info", content_type: "text/plain", content: `Order ${order.display_id || order.id} from ${ctx.storeName}` },
    ],
    links: [
      { type: "self", url: `${baseUrl}/${order.id}` },
    ],
  }
}
