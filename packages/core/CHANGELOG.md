# @financedistrict/medusa-plugin-agentic-commerce

## 0.1.9

### Patch Changes

- [#2](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/2) [`269c1bf`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/269c1bfe8c01c03f98bc302865dbc2604e96e6e0) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Fix two TypeScript issues that locally hid behind permissive node_modules state but failed on a fresh CI install:

  - Updated `z.record(valueSchema)` calls to the two-arg form `z.record(z.string(), valueSchema)` (Zod deprecated the single-arg form).
  - Added `@types/node` as an explicit devDependency so Node globals (`crypto`, `fetch`, `AbortSignal`, `dns/promises`) are typed.
