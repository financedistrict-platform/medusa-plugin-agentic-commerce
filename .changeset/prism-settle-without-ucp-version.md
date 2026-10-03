---
"@financedistrict/medusa-plugin-prism-payment": patch
---

Verify and settle no longer fail when the payment session has no valid `ucp_version`. They send the Prism User-Agent with the latest known UCP version instead, so authorized payments can always be captured. Discovery and prepare calls still require the negotiated version.
