import { AsyncLocalStorage } from "node:async_hooks"
import type { AuthorizePaymentInput, AuthorizePaymentOutput } from "@medusajs/framework/types"
import { CREDENTIAL_HANDOFF_KEY, credentialSha256 } from "../../lib/credential-handoff"

class HandedCredential {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  reveal(): string {
    return this.#value
  }

  toJSON(): string {
    return "[redacted]"
  }
}

type HandoffHolder = { [CREDENTIAL_HANDOFF_KEY]?: AsyncLocalStorage<unknown> }

function handoffStorage(): AsyncLocalStorage<unknown> {
  const holder = globalThis as HandoffHolder
  holder[CREDENTIAL_HANDOFF_KEY] ??= new AsyncLocalStorage<unknown>()
  return holder[CREDENTIAL_HANDOFF_KEY]
}

export function inHandoff<T>(credential: string, work: () => Promise<T>, settlementResume = false): Promise<T> {
  return handoffStorage().run({ credential: new HandedCredential(credential), settlementResume }, work)
}

type Authorizer = { authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> }

export type HandoffOptions = { resume?: boolean }

export async function authorizeWithHandoff(
  provider: Authorizer,
  input: { data?: Record<string, unknown> },
  options: HandoffOptions = {},
): Promise<AuthorizePaymentOutput> {
  const { eip3009_authorization: handed, ...data } = input.data ?? {}
  if (typeof handed !== "string") {
    return provider.authorizePayment({ ...input, data } as AuthorizePaymentInput)
  }
  const digest = typeof data.credential_sha256 === "string" && data.credential_sha256.length > 0
    ? data.credential_sha256
    : credentialSha256(handed)
  return inHandoff(
    handed,
    () => provider.authorizePayment({ ...input, data: { ...data, credential_sha256: digest } } as AuthorizePaymentInput),
    options.resume === true,
  )
}
