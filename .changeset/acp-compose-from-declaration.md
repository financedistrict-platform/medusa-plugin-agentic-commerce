---
"@financedistrict/medusa-plugin-prism-payment": patch
---

The ACP entry is composed from `/api/v2/merchant/acp/handlers` and `/api/v2/merchant/payment-requirements`. One Prism call serves UCP and ACP. A failed re-prepare clears the stored quote. `PrismClient.prepareAcpPayment` is removed.
