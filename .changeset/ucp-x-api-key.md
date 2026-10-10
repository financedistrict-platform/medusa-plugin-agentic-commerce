---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

UCP routes now accept the store key in the `X-API-Key` header as well as `Authorization: Bearer`. An invalid `X-API-Key` returns 401, and idempotency scope and session ownership treat both headers as the same key.
