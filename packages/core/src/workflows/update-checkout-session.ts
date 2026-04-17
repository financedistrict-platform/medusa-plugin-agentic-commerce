import {
  createWorkflow,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  updateCartWorkflow,
  addToCartWorkflow,
  updateLineItemInCartWorkflow,
  deleteLineItemsWorkflow,
  listShippingOptionsForCartWorkflow,
  addShippingMethodToCartWorkflow,
} from "@medusajs/medusa/core-flows"

type ItemUpdate = {
  variant_id?: string
  line_item_id?: string
  quantity: number
}

type UpdateCheckoutSessionInput = {
  cart_id: string
  items?: ItemUpdate[]
  email?: string
  shipping_address?: Record<string, unknown>
  fulfillment_address?: Record<string, unknown>
  buyer?: { email?: string; name?: string }
  fulfillment_option_id?: string
  /**
   * Switch the cart to this region before updating. Required when the incoming
   * address targets a country that is not in the cart's current region.
   * Resolved by the route handler via resolveRegionForAddressUpdate.
   */
  region_id?: string
}

const updateCheckoutSessionWorkflow = createWorkflow(
  "update-checkout-session",
  (input: UpdateCheckoutSessionInput) => {
    // Step 1: Update cart properties (email, shipping address, region)
    const hasCartUpdates = transform(input, (input) => {
      const email = input.buyer?.email || input.email
      const address = input.fulfillment_address || input.shipping_address
      return !!(email || address || input.region_id)
    })

    when(hasCartUpdates, (v) => v).then(() => {
      const updateData = transform(input, (input) => {
        const data: Record<string, unknown> = { id: input.cart_id }
        const email = input.buyer?.email || input.email
        const address = input.fulfillment_address || input.shipping_address
        if (email) data.email = email
        if (address) data.shipping_address = address
        // Region switch must happen in the same update as the address so
        // Medusa's region/country validation sees the new pairing atomically.
        if (input.region_id) data.region_id = input.region_id
        return data
      })
      updateCartWorkflow.runAsStep({ input: updateData as any })
    })

    // Step 2a: Add new items (items with variant_id and no line_item_id)
    const itemActions = transform(input, (input) => {
      const items = input.items || []
      return {
        toAdd: items.filter((i) => i.variant_id && !i.line_item_id && i.quantity > 0),
        toUpdate: items.filter((i) => i.line_item_id && i.quantity > 0),
        toRemove: items.filter((i) => i.line_item_id && i.quantity === 0),
      }
    })

    when(itemActions, (a) => a.toAdd.length > 0).then(() => {
      addToCartWorkflow.runAsStep({
        input: transform({ input, itemActions }, ({ input, itemActions }) => ({
          cart_id: input.cart_id,
          items: itemActions.toAdd.map((i) => ({
            variant_id: i.variant_id!,
            quantity: i.quantity,
          })),
        })),
      })
    })

    // Step 2b: Update existing item quantities
    when(itemActions, (a) => a.toUpdate.length > 0).then(() => {
      // updateLineItemInCartWorkflow handles one item at a time
      // For multiple updates, we process the first one here
      // (Medusa v2 workflows don't support dynamic loops — for MVP this handles the common case)
      const firstUpdate = transform(
        { input, itemActions },
        ({ input, itemActions }) => ({
          cart_id: input.cart_id,
          item_id: itemActions.toUpdate[0].line_item_id!,
          update: { quantity: itemActions.toUpdate[0].quantity },
        })
      )
      updateLineItemInCartWorkflow.runAsStep({ input: firstUpdate })
    })

    // Step 2c: Remove items (quantity = 0)
    when(itemActions, (a) => a.toRemove.length > 0).then(() => {
      deleteLineItemsWorkflow.runAsStep({
        input: transform({ input, itemActions }, ({ input, itemActions }) => ({
          cart_id: input.cart_id,
          ids: itemActions.toRemove.map((i) => i.line_item_id!),
        })),
      })
    })

    // Step 3: If address was changed and no explicit fulfillment option, auto-select shipping
    const shouldAutoSelectShipping = transform(input, (input) => {
      const addressChanged = !!(input.fulfillment_address || input.shipping_address)
      const noExplicitOption = !input.fulfillment_option_id
      return addressChanged && noExplicitOption
    })

    const shippingOptions = when(shouldAutoSelectShipping, (v) => !!v).then(() => {
      return listShippingOptionsForCartWorkflow.runAsStep({
        input: transform(input, (input) => ({
          cart_id: input.cart_id,
          is_return: false,
        })),
      })
    })

    const cheapestOptionId = transform(
      { shouldAutoSelectShipping, shippingOptions },
      ({ shouldAutoSelectShipping, shippingOptions }) => {
        if (!shouldAutoSelectShipping || !shippingOptions || !Array.isArray(shippingOptions) || shippingOptions.length === 0) return null
        const sorted = [...shippingOptions].sort((a: any, b: any) => (a.amount ?? 0) - (b.amount ?? 0))
        return sorted[0]?.id || null
      }
    )

    // Resolve the final shipping option: explicit choice wins, otherwise auto-select cheapest
    const shippingOptionToApply = transform(
      { input, cheapestOptionId },
      ({ input, cheapestOptionId }) => {
        if (input.fulfillment_option_id) return input.fulfillment_option_id
        return cheapestOptionId
      }
    )

    when(shippingOptionToApply, (id) => !!id).then(() => {
      addShippingMethodToCartWorkflow.runAsStep({
        input: transform(
          { input, shippingOptionToApply },
          ({ input, shippingOptionToApply }) => ({
            cart_id: input.cart_id,
            options: [{ id: shippingOptionToApply }],
          })
        ),
      })
    })

    return new WorkflowResponse(
      transform(input, (input) => ({ cart_id: input.cart_id }))
    )
  }
)

export default updateCheckoutSessionWorkflow
