---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

Creating or updating a UCP cart, a UCP checkout session or an ACP checkout session with a client mistake now returns a 4xx instead of 500: an unknown variant is 400 `invalid_data`, an unsupported currency is 400 `invalid_data`, a quantity beyond stock is 422 `not_allowed` and a missing record is 404 `not_found`. Unexpected failures still return 500 `internal_error`, now with a generic message.

Completing a UCP checkout session that is already completed now returns 409 `already_completed` instead of 422 `payment_failed`, matching ACP. A replay with the same Idempotency-Key still returns the original response.
