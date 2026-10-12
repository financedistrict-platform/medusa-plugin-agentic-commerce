---
"@financedistrict/medusa-plugin-prism-payment": patch
---

Verify and settle requests to Prism now carry the `resource` of the signed payment quote. Without it Prism could not record the settlement and every payment failed with `payment_failed`. A credential that names a different `resource` url than the quote is rejected with `resource_mismatch`; a credential that names none is accepted.
