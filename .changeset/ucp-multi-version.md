---
"@financedistrict/medusa-plugin-agentic-commerce": minor
"@financedistrict/medusa-plugin-prism-payment": minor
---

Keep the latest UCP version (currently 2026-08-25, as in 1.0.0) as the default and add 2026-04-08 and 2026-01-23 per agent profile.

- Omitting `ucp_version` serves the latest UCP version. Stores upgrading from 0.x that want the old root profile set `ucp_version: "2026-04-08"`; agents that declare a version in their profile are served that version either way
- `/.well-known/ucp` lists `supported_versions`; `/.well-known/ucp/:version` serves each leaf profile
- New options `ucp_supported_versions` and `ucp_version_negotiation` (`lenient` default, `strict`); unknown values fail at boot
- Checkout sessions created for a declared version stay on it
- Original-era instruments (`tokenized`, `default`, missing `type`, `handler_id` `x402` or missing) complete again; quote binding still applies
- Prism discovery is fetched per UCP version, accepts the legacy Prism entry, and sends `User-Agent: fd-medusa-prism/<version>`
