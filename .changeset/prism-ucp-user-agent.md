---
"@financedistrict/medusa-plugin-agentic-commerce": patch
"@financedistrict/medusa-plugin-prism-payment": patch
---

Send `User-Agent: fd-medusa-prism/<ucp-version>` on every Prism call so Prism picks the handler contract for that UCP version, and stop sending the `ucp_version` query.

- UCP discovery and UCP checkout use the request's UCP version; ACP routes and ACP discovery use the store's current `ucp_version`
- `CheckoutPrepareInput` has a new `ucpVersion` field and `getAcpDiscoveryHandlers` receives the UCP version; custom payment handler adapters can ignore both
- Requires the matching agentic-commerce patch: pair the new prism-payment release with it
