import type { AsyncLocalStorage } from "node:async_hooks"
import { CREDENTIAL_HANDOFF_KEY, type CredentialHandoff } from "../../lib/credential-handoff"

type HandoffHolder = { [CREDENTIAL_HANDOFF_KEY]?: AsyncLocalStorage<CredentialHandoff> }

export function currentHandoff(): CredentialHandoff | undefined {
  return (globalThis as HandoffHolder)[CREDENTIAL_HANDOFF_KEY]?.getStore()
}

export function handedCredential(): string | null {
  return currentHandoff()?.credential.reveal() ?? null
}
