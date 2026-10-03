---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

Follow one same-origin redirect when fetching the agent profile, so a trailing-slash 301/308 no longer falls back to the current version.

- Any other redirect (cross-origin, scheme change, Location with userinfo, a second redirect, missing Location) answers `424 profile_redirected` in lenient and strict mode, naming the Location
- The resolution log includes `location` when the profile redirects
