---
"@financedistrict/medusa-plugin-prism-payment": patch
---

Prepare UCP checkouts with Prism's protocol-free `POST /api/v2/merchant/payment-requirements`, which returns raw x402. The plugin builds the `xyz.fd.prism_payment` checkout entry from the handler declaration it serves in discovery for the same UCP version, so `id` and `version` always match `/.well-known/ucp`. If no declaration is available the UCP entry is omitted. ACP is unchanged. Needs Prism with the new route.
