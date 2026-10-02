# @financedistrict/medusa-plugin-agentic-commerce

## 1.1.0

### Minor Changes

- [#24](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/24) [`3c4f678`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/3c4f678f92b22c1212b87b7fdff3bec24c5bdc4d) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - Keep the latest UCP version (currently 2026-08-25, as in 1.0.0) as the default and add 2026-04-08 and 2026-01-23 per agent profile.

  - Omitting `ucp_version` serves the latest UCP version. Stores upgrading from 0.x that want the old root profile set `ucp_version: "2026-04-08"`; agents that declare a version in their profile are served that version either way
  - `/.well-known/ucp` lists `supported_versions`; `/.well-known/ucp/:version` serves each leaf profile
  - New options `ucp_supported_versions` and `ucp_version_negotiation` (`lenient` default, `strict`); unknown values fail at boot
  - Checkout sessions created for a declared version stay on it
  - Original-era instruments (`tokenized`, `default`, missing `type`, `handler_id` `x402` or missing) complete again; quote binding still applies
  - Prism discovery is fetched per UCP version, accepts the legacy Prism entry, and sends `User-Agent: fd-medusa-prism/<version>`

## 1.0.0

### Major Changes

- [#22](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/22) [`c0c599d`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/c0c599d6f8a580d9b5d700ffa96c0fb733184f46) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - Move UCP support to protocol version 2026-08-25.

  - UCP 2026-08-25 is the default `ucp_version`. `/.well-known/ucp` and `/well-known/ucp` share one profile builder: every service and capability carries version 2026-08-25 with a `spec` and `schema`, catalog capabilities point at `catalog_search.json` / `catalog_lookup.json`, and `signing_keys` is no longer emitted.
  - Payment handler entries from Prism are passed through unchanged. The Prism handler is advertised only when its `xyz.fd.prism_payment` entry has `id`, `version`, `spec` and `schema`; an invalid or unreachable response is logged and omitted instead of cached.
  - On checkout complete, instrument `id`, `handler_id` and `type` are required, and a sent `credential` must carry `type`. Invalid bodies return 400 `invalid_instrument` in the UCP error shape.
  - The Prism handler id is `xyz.fd.prism_payment` with instrument and credential type `x402`. When the Prism provider is configured, unknown handler ids and other types are rejected with 422 before any payment runs, and a cart with a Prism quote that cannot be matched to the signed payment is rejected instead of settled.
  - Payment failures on complete return 422 `payment_failed` with a fixed message; details are logged server-side only.

## 0.1.12

### Patch Changes

- [#19](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/19) [`fe1e7d5`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/fe1e7d5dffb038d9b5512554921ff17de4deb1c5) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - fix: add ./admin entry to package exports

  Missing ./admin in the exports map caused Medusa's admin bundler to
  silently skip the plugin's admin UI.

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
