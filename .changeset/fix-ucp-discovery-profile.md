---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

Fix UCP version string and complete discovery profile

Updates the UCP version from `2026-01-11` to `2026-04-08` across all routes and middleware. Completes the `/.well-known/ucp` discovery profile with `spec`+`schema` on all capabilities, service block metadata, `fulfillment` capability, payment handler `name`, top-level store `name`, and `signing_keys`.
