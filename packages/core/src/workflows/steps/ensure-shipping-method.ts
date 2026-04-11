import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  listShippingOptionsForCartWorkflow,
  addShippingMethodToCartWorkflow,
} from "@medusajs/medusa/core-flows"

type EnsureShippingInput = {
  cart_id: string
}

export const ensureShippingMethodStep = createStep(
  "ensure-shipping-method",
  async ({ cart_id }: EnsureShippingInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Check if cart already has shipping methods
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: ["id", "shipping_methods.id"],
      filters: { id: cart_id },
    })

    if (cart?.shipping_methods && cart.shipping_methods.length > 0) {
      return new StepResponse({
        cart_id,
        shipping_option_id: null,
        already_set: true,
      })
    }

    // List available shipping options for this cart
    const { result: shippingOptions } = await listShippingOptionsForCartWorkflow(
      container
    ).run({
      input: { cart_id, is_return: false },
    })

    if (!shippingOptions || shippingOptions.length === 0) {
      // No shipping options available — this is OK for digital goods
      // but will block checkout for physical goods
      return new StepResponse({
        cart_id,
        shipping_option_id: null,
        already_set: false,
      })
    }

    // Pick the cheapest option
    const cheapest = shippingOptions.sort(
      (a: any, b: any) => (a.amount ?? 0) - (b.amount ?? 0)
    )[0]

    // Add shipping method to cart
    await addShippingMethodToCartWorkflow(container).run({
      input: {
        cart_id,
        options: [{ id: cheapest.id }],
      },
    })

    return new StepResponse({
      cart_id,
      shipping_option_id: cheapest.id,
      already_set: false,
    })
  }
)
