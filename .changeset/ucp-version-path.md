---
"@financedistrict/medusa-plugin-prism-payment": patch
---

Call Prism with the UCP version in the path (`/api/v2/merchant/ucp/<ucp-version>/handlers` and `/payment-requirements`). User-Agent is `fd-medusa-prism/<package version>`. ACP, verify and settle no longer send a UCP version. Needs Prism with versioned routes.
