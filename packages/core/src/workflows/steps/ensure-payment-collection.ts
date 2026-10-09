import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"

type EnsurePaymentCollectionInput = {
  cart_id: string
}

export const ensurePaymentCollectionStep = createStep(
  "ensure-payment-collection",
  async ({ cart_id }: EnsurePaymentCollectionInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const paymentCollectionIdOf = async () => {
      const { data: [cart] } = await query.graph({
        entity: "cart",
        fields: ["id", "payment_collection.id"],
        filters: { id: cart_id },
      })
      return cart?.payment_collection?.id as string | undefined
    }

    const existingId = await paymentCollectionIdOf()
    if (existingId) {
      return new StepResponse({ cart_id, payment_collection_id: existingId })
    }

    await createPaymentCollectionForCartWorkflow(container).run({
      input: { cart_id },
    })

    const createdId = await paymentCollectionIdOf()
    if (!createdId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to create payment collection for cart"
      )
    }
    return new StepResponse({ cart_id, payment_collection_id: createdId })
  }
)
