const SYSTEM_PROVIDER_PREFIX = "pp_system_"
const LOCAL_NODE_ENVS: readonly string[] = ["development", "test"]

export type PaymentProviderConfig = {
  payment_provider_id?: string
  allow_system_payment_provider?: boolean
  payment_handler_adapters?: string[]
}

export function resolvePaymentProviderId(
  options: PaymentProviderConfig,
  env: Record<string, string | undefined> = process.env,
): string {
  const providerId = options.payment_provider_id || env.AGENTIC_PAYMENT_PROVIDER
  if (!providerId) {
    throw new Error("[agentic-commerce] payment_provider_id is required. Set it to the Medusa payment provider that settles agent payments, for example pp_prism_prism.")
  }
  if (!providerId.startsWith(SYSTEM_PROVIDER_PREFIX)) return providerId

  if ((options.payment_handler_adapters ?? []).length > 0) {
    throw new Error(`[agentic-commerce] ${providerId} approves every payment and cannot settle for the configured payment handlers. Set payment_provider_id to their payment provider, for example pp_prism_prism.`)
  }
  if (options.allow_system_payment_provider !== true || !LOCAL_NODE_ENVS.includes(env.NODE_ENV ?? "")) {
    throw new Error(`[agentic-commerce] ${providerId} approves every payment. It needs allow_system_payment_provider: true and NODE_ENV development or test.`)
  }
  return providerId
}
