---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

Agent webhooks are now delivered only to the address that passed the URL check. The host is resolved once and every attempt connects to that address, a redirect is never followed (a 3xx is a failed delivery and is not retried), and IPv4-mapped IPv6 addresses such as `[::ffff:127.0.0.1]` are rejected like the IPv4 address they carry.

With no `signatureKey` the store now logs a warning at startup and rejects inbound `Signature` headers instead of verifying them against an empty key. Set `signatureKey` or `AGENTIC_COMMERCE_SIGNATURE_KEY` to sign outbound webhooks with a secret.
