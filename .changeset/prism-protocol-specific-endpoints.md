---
"@financedistrict/medusa-plugin-prism-payment": minor
---

Switch Prism handler to protocol-specific Merchant API endpoints. The legacy `/api/v2/merchant/payment-profile` and `/api/v2/merchant/checkout-prepare` endpoints are deprecated; the handler now calls `/api/v2/merchant/{ucp,acp}/handlers` for discovery and `/api/v2/merchant/{ucp,acp}/payment-requirements` for checkout prepare.

Behavior changes:

- **UCP discovery** now includes the `spec` and `schema` fields from Prism's response (previously omitted).
- **ACP discovery and checkout-context handlers** are passed through verbatim from Prism instead of being hand-constructed on the client. Fields like `requires_delegate_payment`, `psp`, `config_schema`, and `instrument_schemas` now reflect Prism's authoritative values.
- **`prepareCheckoutPayment`** calls UCP and ACP prepare endpoints in parallel (fail-soft per protocol) and stores both responses on the cart.

Storage moved from `prism_checkout_config` to `prism_checkout_data` (new shape — UCP and ACP wrapped together with idempotency markers). Old key still re-exported for any external readers.

Mirrors the equivalent fix in [saleor-agentic-commerce#33](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/33).
