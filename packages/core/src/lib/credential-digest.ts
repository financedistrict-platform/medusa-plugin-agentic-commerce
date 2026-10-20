import { createHash } from "node:crypto"

export function credentialSha256(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex")
}
