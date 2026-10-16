---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

UCP carts, checkout sessions and orders answer `401 session_secret_required` when the `UCP-Session-Secret` header is missing, before anything is read, and `404 cart_not_found`, `checkout_not_found` or `order_not_found` when the secret is wrong or the id is unknown. This replaces `403 session_ownership_mismatch` and the generic `404 not_found` on UCP routes, so every Finance District store plugin answers the same way. ACP routes are unchanged.
