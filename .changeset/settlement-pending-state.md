---
"@financedistrict/medusa-plugin-agentic-commerce": patch
"@financedistrict/medusa-plugin-prism-payment": patch
---

Keep a pending or unknown Prism settlement open under the cart lock: UCP answers 202 or 200 with the session, ACP answers 409, a retry with the same credential resumes, a different credential is refused, and update and cancel wait. Stores must run `npx medusa db:migrate`. A failure after the payment provider was called but before its answer was saved holds the payment for review, so the cart cannot be paid again with another credential.
