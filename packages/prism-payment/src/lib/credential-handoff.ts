import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"

export const CREDENTIAL_HANDOFF_KEY = Symbol.for("fd.agentic.prism.credential")

export type CredentialHandoff = {
  credential: string
  settlementResume: boolean
}

type HandoffHolder = { [CREDENTIAL_HANDOFF_KEY]?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function revealed(value: unknown): string | null {
  if (!isRecord(value)) return null
  const reveal = value.reveal
  if (typeof reveal !== "function") return null
  const secret: unknown = reveal.call(value)
  return typeof secret === "string" && secret.length > 0 ? secret : null
}

export function currentCredentialHandoff(): CredentialHandoff | null {
  const storage = (globalThis as HandoffHolder)[CREDENTIAL_HANDOFF_KEY]
  if (!(storage instanceof AsyncLocalStorage)) return null
  const store: unknown = storage.getStore()
  if (!isRecord(store)) return null
  const credential = revealed(store.credential)
  if (!credential) return null
  return { credential, settlementResume: store.settlementResume === true }
}

export function credentialSha256(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex")
}
