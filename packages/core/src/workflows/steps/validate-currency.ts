import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

type ValidateCurrencyInput = {
  currency_code?: string
}

type Resolver = { resolve: (name: string) => unknown }

export async function assertCurrencySupported(container: Resolver, currencyCode: string | undefined): Promise<void> {
  if (!currencyCode) return

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(input: unknown): Promise<{ data: { supported_currencies?: { currency_code: string }[] }[] }>
  }
  const { data: [store] } = await query.graph({
    entity: "store",
    fields: ["supported_currencies.currency_code"],
  })

  const supported = (store?.supported_currencies ?? []).map((currency) => currency.currency_code.toLowerCase())

  if (!supported.includes(currencyCode.toLowerCase())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Currency "${currencyCode}" is not supported. Supported currencies: ${supported.join(", ") || "(none configured)"}.`
    )
  }
}

export const validateCurrencyStep = createStep(
  "validate-currency",
  async ({ currency_code }: ValidateCurrencyInput, { container }) => {
    await assertCurrencySupported(container, currency_code)
    return new StepResponse({ currency_code })
  }
)
