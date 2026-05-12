---
"@financedistrict/medusa-plugin-prism-payment": patch
---

Fix 100× under-quote in `prepareCheckoutPayment`.

Medusa v2 stores `cart.total` in major units as a BigNumber (e.g., `17` for €17.00), but the prism payment handler was dividing by 100 on the wrong assumption that it was in cents. That produced a 100× under-quote to Prism — a €17 cart became a `"0.17"` amount, which Prism converted to `170000` raw EURC instead of `17000000`.

The handler now passes `cart.total` through as a major-unit decimal string, matching what `prism-client.ts` documents the `amount` field expects.
