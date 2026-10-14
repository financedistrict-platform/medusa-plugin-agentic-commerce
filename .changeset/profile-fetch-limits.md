---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

Stop one caller from starving agent profile fetches for everyone. The in-flight limit is now kept per fetcher instead of per process, with extra limits per host and per client ip, one shared fetch for concurrent lookups of the same url, and DNS time counted inside the 3 s fetch deadline. A busy fetcher now answers with the last known profile of that url, and is reported as `busy` instead of `unreachable`. Under strict negotiation a busy fetcher answers `503 profile_fetch_busy` with `Retry-After`, and a cart or checkout session that already has a version keeps working in that version.
