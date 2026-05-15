---
"@financedistrict/medusa-plugin-prism-payment": patch
---

Fix the `/complete` settle regression where Medusa returned HTTP 500 `was not authorized with the provider` for every Prism x402 payment. Root cause: the provider's Prism API client was reading legacy response field names that no longer match what Prism Gateway returns.

The canonical Prism Gateway response shape (per the `@1stdigital/prism-core` client) is:

- `POST /api/v2/payment/verify` → `{ isValid: boolean, payer?: string, error?: string }`
- `POST /api/v2/payment/settle` → `{ success: boolean, payer?: string, transaction?: string, network?: string, errorReason?: string }`

The provider was reading `verifyResult.valid` (always `undefined` against the current Gateway) and treating that as a failed verification, returning `prism_verification_failed: undefined` without ever calling `/settle`. Even on a hypothetical successful settle the on-chain tx hash would be lost too — the settle handler read `facilitatorTransactionId` / `errorMessage` / `errorCode` / `acceptedAt`, all of which are absent from the current Prism response.

The fix aligns the provider's response parsing with the canonical shape and defensively accepts the legacy field names as fallbacks so a future Prism rename doesn't silently break us again. The verify check now fails closed when the response has neither `isValid` nor `valid` explicitly set to `true`.
