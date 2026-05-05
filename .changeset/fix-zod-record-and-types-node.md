---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

Fix two TypeScript issues that locally hid behind permissive node_modules state but failed on a fresh CI install:

- Updated `z.record(valueSchema)` calls to the two-arg form `z.record(z.string(), valueSchema)` (Zod deprecated the single-arg form).
- Added `@types/node` as an explicit devDependency so Node globals (`crypto`, `fetch`, `AbortSignal`, `dns/promises`) are typed.
