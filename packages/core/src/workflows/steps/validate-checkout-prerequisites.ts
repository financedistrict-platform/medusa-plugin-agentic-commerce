import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { CART_VALIDATION_FIELDS } from "../../lib/cart-fields"

type ValidateInput = {
  cart_id: string
}

export const validateCheckoutPrerequisitesStep = createStep(
  "validate-checkout-prerequisites",
  async ({ cart_id }: ValidateInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: CART_VALIDATION_FIELDS,
      filters: { id: cart_id },
    })

    if (!cart) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Cart ${cart_id} not found`
      )
    }

    if (cart.metadata?.checkout_session_canceled) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Checkout session has been cancelled"
      )
    }

    if (cart.completed_at) {
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        "Checkout session has already been completed"
      )
    }

    if (!cart.items || cart.items.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cart is empty — add items before completing checkout"
      )
    }

    if (!cart.email) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Email is required to complete checkout"
      )
    }

    if (!cart.shipping_address?.id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Shipping address is required to complete checkout"
      )
    }

    return new StepResponse({ cart_id, validated: true })
  }
)
