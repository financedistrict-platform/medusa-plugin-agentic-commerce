---
"@financedistrict/medusa-plugin-agentic-commerce": patch
"@financedistrict/medusa-plugin-prism-payment": patch
---

The payment credential is handed to the Prism provider in memory for the one completion request and is never written to payment-session data or workflow input; only its SHA-256 digest and signed summary are kept. The Prism provider authorizes only with that handed credential when it matches the session digest, builds every session data object from a closed set of keys, and clears settlement fields that a client writes into a session. Medusa's own cart completion is refused for a cart that holds a Prism payment session without an agent session. `auto_capture: false` is no longer supported and stops the store at boot. Upgrade both packages together: a store that mixes an older and a newer version of the two packages declines every Prism payment.
