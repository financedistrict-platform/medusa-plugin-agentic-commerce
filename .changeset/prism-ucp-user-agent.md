---
"@financedistrict/medusa-plugin-agentic-commerce": patch
"@financedistrict/medusa-plugin-prism-payment": patch
---

Send `User-Agent: fd-medusa-prism/<ucp-version>` on every Prism call so Prism picks the handler contract for that UCP version, and stop sending the `ucp_version` query.

- UCP discovery and UCP checkout use the request's UCP version; ACP routes and ACP discovery use the store's current `ucp_version`
- `CheckoutPrepareInput` has a new `ucpVersion` field and `getAcpDiscoveryHandlers` receives the UCP version; custom payment handler adapters can ignore both
- Requires the matching agentic-commerce patch: pair the new prism-payment release with it
- The 2026-01-23 profile links `services/shopping/openapi.json`
- Strict negotiation answers `424 profile_unreachable` and `422 profile_malformed`
- An unknown declared version is rejected with `422 version_unsupported` in both modes
- A session pin mismatch says which version the session is bound to and which version the profile now declares
- Carts are pinned to the matched UCP version, like checkout sessions
- The agent profile size cap is 128 KiB
