---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

Accept agent currency codes in any case. `context.currency` on UCP checkout and cart create, and `currency` on ACP checkout create, are lowercased before they reach the Medusa cart, so `"USD"` no longer fails with a 500. Responses still return upper-case ISO 4217 codes.
