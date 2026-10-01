---
"@financedistrict/medusa-plugin-agentic-commerce": minor
"@financedistrict/medusa-plugin-prism-payment": minor
---

Serve UCP 2026-04-08 by default again and add 2026-08-25 and 2026-01-23 per agent profile.

- `/.well-known/ucp` lists `supported_versions`; `/.well-known/ucp/:version` serves each leaf profile
- New options `ucp_supported_versions` and `ucp_version_negotiation` (`lenient` default, `strict`); unknown values fail at boot
- Checkout sessions created for a declared version stay on it
- Original-era instruments (`tokenized`, `default`, missing `type`, `handler_id` `x402` or missing) complete again; quote binding still applies
- Prism discovery is fetched per UCP version, accepts the legacy Prism entry, and sends `User-Agent: fd-medusa-prism/<version>`
