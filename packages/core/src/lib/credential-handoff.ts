import { AsyncLocalStorage } from "node:async_hooks"
import { inspect } from "node:util"

export const CREDENTIAL_HANDOFF_KEY = Symbol.for("fd.agentic.prism.credential")

const REDACTED = "[redacted]"

export class Redacted<T> {
  readonly #value: T

  constructor(value: T) {
    this.#value = value
  }

  reveal(): T {
    return this.#value
  }

  toJSON(): string {
    return REDACTED
  }

  toString(): string {
    return REDACTED
  }

  [inspect.custom](): string {
    return REDACTED
  }
}

export type CredentialHandoff = {
  readonly credential: Redacted<string>
  settlementResume: boolean
}

type HandoffHolder = { [CREDENTIAL_HANDOFF_KEY]?: AsyncLocalStorage<CredentialHandoff> }

function handoffStorage(): AsyncLocalStorage<CredentialHandoff> {
  const holder = globalThis as HandoffHolder
  holder[CREDENTIAL_HANDOFF_KEY] ??= new AsyncLocalStorage<CredentialHandoff>()
  return holder[CREDENTIAL_HANDOFF_KEY]
}

export function withCredentialHandoff<T>(credential: Redacted<string>, work: () => Promise<T>): Promise<T> {
  return handoffStorage().run({ credential, settlementResume: false }, work)
}

export function markSettlementResume(resumed: boolean): void {
  const handoff = handoffStorage().getStore()
  if (handoff) handoff.settlementResume = resumed
}
