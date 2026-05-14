# @financedistrict/medusa-plugin-prism-payment

## 0.3.2

### Patch Changes

- [#10](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/10) [`fe1af03`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/fe1af0353aca2bf43c72ffabf15caabc2ec1a573) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Fix the empty `payment_handlers` regression on checkout session responses. PR [#8](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/issues/8) ("pass cart.total in major units") changed amount construction from `(totalMinor / 100).toString()` to `String(totalMajor)`. The previous division accidentally triggered Medusa v2 BigNumber's `Symbol.toPrimitive` with hint `"number"` (returning the plain `.numeric` value), so the final `.toString()` ran on a regular JS number and produced a clean decimal string. The new direct `String()` triggers `Symbol.toPrimitive` with hint `"string"`, which returns the underlying bignumber.js raw value at 20-digit precision — e.g. `"34"` becomes `"34.000000000000000000"`. Prism's `/payment-requirements` endpoint rejects that format, the call throws, `Promise.allSettled` swallows the rejection, the adapter returns `null`, no metadata is written to the cart, and the checkout session response renders with `payment_handlers: {}` — agents see `ready_for_complete` with no way to pay.

  The fix coerces `cart.total` to a plain number via `Number()` (which triggers `Symbol.toPrimitive` with hint `"number"` → returns `BigNumber.numeric`) before stringifying, so the amount sent to Prism is `"34"` or `"17.5"` as expected. Adds two regression tests on the existing amount-unit suite that exercise the actual Medusa BigNumber `Symbol.toPrimitive` contract — the original tests passed plain JS numbers and therefore couldn't catch this class of bug.

## 0.3.1

### Patch Changes

- [#8](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/8) [`a623f0b`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/a623f0b2ab1542437f998357ac3942082ff93260) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Fix 100× under-quote in `prepareCheckoutPayment`.

  Medusa v2 stores `cart.total` in major units as a BigNumber (e.g., `17` for €17.00), but the prism payment handler was dividing by 100 on the wrong assumption that it was in cents. That produced a 100× under-quote to Prism — a €17 cart became a `"0.17"` amount, which Prism converted to `170000` raw EURC instead of `17000000`.

  The handler now passes `cart.total` through as a major-unit decimal string, matching what `prism-client.ts` documents the `amount` field expects.

## 0.3.0

### Minor Changes

- [#2](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/pull/2) [`269c1bf`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/269c1bfe8c01c03f98bc302865dbc2604e96e6e0) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Switch Prism handler to protocol-specific Merchant API endpoints. The legacy `/api/v2/merchant/payment-profile` and `/api/v2/merchant/checkout-prepare` endpoints are deprecated; the handler now calls `/api/v2/merchant/{ucp,acp}/handlers` for discovery and `/api/v2/merchant/{ucp,acp}/payment-requirements` for checkout prepare.

  Behavior changes:

  - **UCP discovery** now includes the `spec` and `schema` fields from Prism's response (previously omitted).
  - **ACP discovery and checkout-context handlers** are passed through verbatim from Prism instead of being hand-constructed on the client. Fields like `requires_delegate_payment`, `psp`, `config_schema`, and `instrument_schemas` now reflect Prism's authoritative values.
  - **`prepareCheckoutPayment`** calls UCP and ACP prepare endpoints in parallel (fail-soft per protocol) and stores both responses on the cart.

  Storage moved from `prism_checkout_config` to `prism_checkout_data` (new shape — UCP and ACP wrapped together with idempotency markers). Old key still re-exported for any external readers.

  Mirrors the equivalent fix in [saleor-agentic-commerce#33](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/33).

### Patch Changes

- Updated dependencies [[`269c1bf`](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/commit/269c1bfe8c01c03f98bc302865dbc2604e96e6e0)]:
  - @financedistrict/medusa-plugin-agentic-commerce@0.1.9
