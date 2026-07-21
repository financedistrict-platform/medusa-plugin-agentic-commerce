# @financedistrict/medusa-plugin-agentic-commerce

## 0.1.11

### Patch Changes

- [#17](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/17) [`378a7b0`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/378a7b0494b329ba09d4c7ab37e7d9b25077cc34) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Fix UCP version string and complete discovery profile

  Updates the UCP version from `2026-01-11` to `2026-04-08` across all routes and middleware. Completes the `/.well-known/ucp` discovery profile with `spec`+`schema` on all capabilities, service block metadata, `fulfillment` capability, payment handler `name`, top-level store `name`, and `signing_keys`.

## 0.1.10

### Patch Changes

- [#15](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/15) [`380ac6e`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/380ac6e35a5d08b98154ddc5e71d79ba4cf25f40) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Security: validate the agent's signed x402/EIP-3009 payment payload against the cart's stored Prism quote (network, asset, amount, recipient) at the UCP and ACP `/complete` route handlers before forwarding to settlement. Closes a class of payment-validation gaps where the SDK could accept a signed payload whose fields didn't match the merchant's quote. Mismatches now return HTTP 422 with a specific error code.

## 0.1.9

### Patch Changes

- [#2](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/2) [`269c1bf`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/269c1bfe8c01c03f98bc302865dbc2604e96e6e0) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Fix two TypeScript issues that locally hid behind permissive node_modules state but failed on a fresh CI install:

  - Updated `z.record(valueSchema)` calls to the two-arg form `z.record(z.string(), valueSchema)` (Zod deprecated the single-arg form).
  - Added `@types/node` as an explicit devDependency so Node globals (`crypto`, `fetch`, `AbortSignal`, `dns/promises`) are typed.
