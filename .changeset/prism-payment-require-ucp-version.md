---
"@financedistrict/medusa-plugin-prism-payment": patch
---

Authorize and capture reject a payment session that has no `ucp_version` with a clear error, instead of sending an unchecked value to Prism. This change landed in #28 without a changeset.
