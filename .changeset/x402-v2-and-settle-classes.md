---
"@financedistrict/medusa-plugin-prism-payment": patch
---

Accept x402 v2 only, classify every Prism settle reply as settled, pending, review or declined, bound the settle call to 60 seconds, and expire signed quotes after 900 seconds.
