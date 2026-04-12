import {
  createWorkflow,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  createCartWorkflow,
  updateCartWorkflow,
  listShippingOptionsForCartWorkflow,
  addShippingMethodToCartWorkflow,
} from "@medusajs/medusa/core-flows"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"

type CreateCheckoutSessionInput = {
  items: { variant_id: string; quantity: number }[]
  region_id?: string
  email?: string
  currency_code?: string
  shipping_address?: Record<string, unknown>
  fulfillment_address?: Record<string, unknown>
  buyer?: { email?: string; name?: string }
  webhook_url?: string
  protocol: "acp" | "ucp"
  agent_identifier?: string
  protocol_version?: string
}

const createCheckoutSessionWorkflow = createWorkflow(
  "create-checkout-session",
  (input: CreateCheckoutSessionInput) => {
    // Step 1: Resolve region if not provided
    const regions = useQueryGraphStep({
      entity: "region",
      fields: ["id", "currency_code"],
      pagination: { take: 1 },
    }).config({ name: "fetch-default-region" })

    const cartInput = transform(
      { input, regions },
      ({ input, regions }) => {
        const regionId = input.region_id || regions.data?.[0]?.id
        if (!regionId) {
          throw new Error("No regions configured in the store")
        }

        const email = input.buyer?.email || input.email
        const address = input.fulfillment_address || input.shipping_address

        return {
          region_id: regionId,
          email: email || undefined,
          currency_code: input.currency_code || "eur",
          items: input.items.map((i) => ({
            variant_id: i.variant_id,
            quantity: i.quantity,
          })),
          metadata: {
            is_checkout_session: true,
            protocol_type: input.protocol,
            protocol_version: input.protocol_version || null,
            // Sanitize: strip control chars, truncate to 256 chars
            agent_identifier: (input.agent_identifier || "unknown")
              .replace(/[\x00-\x1f\x7f]/g, "")
              .slice(0, 256),
            checkout_session_created_at: new Date().toISOString(),
            ...(input.webhook_url ? { agent_webhook_url: input.webhook_url } : {}),
          },
          ...(address ? { shipping_address: address } : {}),
        }
      }
    )

    // Step 2: Create the cart
    const cart = createCartWorkflow.runAsStep({
      input: cartInput,
    })

    // Step 3: If shipping address was provided, auto-select cheapest shipping
    const cartId = transform(cart, (cart) => cart.id)

    const hasAddress = transform(input, (input) => !!(input.fulfillment_address || input.shipping_address))

    const shippingOptions = when(hasAddress, (has) => !!has).then(() => {
      return listShippingOptionsForCartWorkflow.runAsStep({
        input: transform(cartId, (id) => ({ cart_id: id, is_return: false })),
      })
    })

    const shouldAddShipping = transform(
      { hasAddress, shippingOptions },
      ({ hasAddress, shippingOptions }) => {
        if (!hasAddress || !shippingOptions || !Array.isArray(shippingOptions) || shippingOptions.length === 0) return null
        const sorted = [...shippingOptions].sort((a: any, b: any) => (a.amount ?? 0) - (b.amount ?? 0))
        return sorted[0]?.id || null
      }
    )

    when(shouldAddShipping, (id) => !!id).then(() => {
      addShippingMethodToCartWorkflow.runAsStep({
        input: transform(
          { cartId, shouldAddShipping },
          ({ cartId, shouldAddShipping }) => ({
            cart_id: cartId,
            options: [{ id: shouldAddShipping }],
          })
        ),
      })
    })

    return new WorkflowResponse(cart)
  }
)

export default createCheckoutSessionWorkflow
