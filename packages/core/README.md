# @financedistrict/medusa-plugin-agentic-commerce

Make your Medusa v2 store shoppable by AI agents.

This plugin adds [UCP](https://ucp.dev/) and [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) protocol endpoints to your Medusa backend, so AI shopping agents can discover your products, create checkouts, and complete purchases — through standard HTTP APIs that require no frontend at all.

## Why this matters

AI agents are becoming the next commerce channel. Just like merchants once added mobile apps alongside their websites, they'll soon need to serve autonomous agents that shop on behalf of consumers. But agents don't browse — they need structured APIs with standardized discovery, checkout flows, and payment settlement.

**UCP** (Universal Commerce Protocol) and **ACP** (Agentic Commerce Protocol) are the emerging open standards for this. This plugin implements both as native Medusa v2 modules, so your store speaks the language agents understand — in minutes, with no custom code and no frontend changes.

## What you get

| Feature | Description |
|---------|-------------|
| **Dual protocol support** | Both UCP and ACP endpoints from a single plugin |
| **Product discovery** | Full-text search and direct lookup for agents to browse your catalog |
| **Checkout sessions** | Create, update, complete, and cancel — with idempotency built in |
| **Pluggable payments** | Bring your own payment handler via the adapter interface |
| **Order tracking** | Agents can retrieve order status and details |
| **Webhook notifications** | Automatic agent callbacks on order placement |
| **Protocol discovery** | `/.well-known/ucp` and `/.well-known/acp.json` for automatic capability detection |
| **Product feed sync** | Scheduled job to push your catalog to agent platforms |

## Quick Start

### 1. Install

```bash
npm install @financedistrict/medusa-plugin-agentic-commerce
```

### 2. Configure `medusa-config.ts`

```typescript
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  // Register the plugin for route/workflow/subscriber auto-discovery
  plugins: [
    {
      resolve: "@financedistrict/medusa-plugin-agentic-commerce",
      options: {},
    },
  ],
  modules: [
    // Register the core service module with your configuration
    {
      key: "agenticCommerce",
      resolve: "@financedistrict/medusa-plugin-agentic-commerce/modules/agentic-commerce",
      options: {
        api_key: process.env.AGENTIC_COMMERCE_API_KEY,
        signatureKey: process.env.AGENTIC_COMMERCE_SIGNATURE_KEY,
        storefront_url: process.env.STOREFRONT_URL || "https://your-store.com",
        store_name: "Your Store Name",
        store_description: "What your store sells",
        // Reference payment handler adapter module keys (see Payment Handlers)
        payment_handler_adapters: ["prismPaymentHandler"],
      },
    },
  ],
})
```

### 3. Set Environment Variables

```bash
# Required
AGENTIC_COMMERCE_API_KEY=your-secret-api-key

# Optional
AGENTIC_COMMERCE_SIGNATURE_KEY=your-hmac-secret
STOREFRONT_URL=https://your-store.com
AGENTIC_STORE_NAME="Your Store"
AGENTIC_STORE_DESCRIPTION="Premium widgets for humans and agents"
```

### 4. Start Your Store

```bash
npx medusa develop
```

Your agent APIs are now live:

```bash
# Discovery
curl http://localhost:9000/.well-known/ucp
curl http://localhost:9000/.well-known/acp.json

# Search products (UCP)
curl -X POST http://localhost:9000/ucp/catalog/search \
  -H "UCP-Agent: my-agent/1.0" \
  -H "Request-Id: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"query": "t-shirt", "limit": 10}'
```

## Protocols

### UCP (Unified Commerce Protocol)

UCP is designed for **agent-to-merchant** interactions. It uses a shopping-cart model where agents manage carts directly.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/ucp` | GET | Protocol discovery and capabilities, with `supported_versions` |
| `/.well-known/ucp/:version` | GET | Discovery profile for one enabled UCP version (404 when not enabled) |
| `/ucp/catalog/search` | POST | Full-text product search |
| `/ucp/catalog/lookup` | POST | Direct product lookup by ID or handle |
| `/ucp/carts` | POST | Create a new cart |
| `/ucp/carts/:id` | GET | Retrieve cart |
| `/ucp/carts/:id` | PUT | Update cart (add/remove items, set address) |
| `/ucp/checkout-sessions` | POST | Create checkout session from cart |
| `/ucp/checkout-sessions/:id` | GET | Retrieve checkout session |
| `/ucp/checkout-sessions/:id` | PUT | Update checkout session |
| `/ucp/checkout-sessions/:id/complete` | POST | Complete checkout and place order |
| `/ucp/checkout-sessions/:id/cancel` | POST | Cancel checkout session |
| `/ucp/orders/:id` | GET | Retrieve order details |

**Required headers:** `UCP-Agent`, `Request-Id`

**Versions:** the store serves `ucp_version` (default: the latest version, currently `2026-08-25`) plus every version in `ucp_supported_versions` (default: every other known version, currently `2026-04-08`, `2026-01-23`). The version for a request comes from the `ucp.version` of the agent profile named in `UCP-Agent: ...; profile="https://..."`. The profile is fetched over HTTPS only, from public addresses only, with a 3 s timeout, a 128 KiB cap and no redirects, and cached for 10 minutes.

| Agent profile | `lenient` (default) | `strict` |
|---|---|---|
| no `UCP-Agent` header | `400 missing_ucp_agent` | `400 missing_ucp_agent` |
| no `profile` in `UCP-Agent` | current version | current version |
| unreachable or not HTTPS | current version + warning log | `424 profile_unreachable` |
| no or malformed `ucp.version` | current version + warning log | `422 profile_malformed` |
| unknown version | `422 version_unsupported` | `422 version_unsupported` |
| known version the store disabled | `422 version_unsupported` | `422 version_unsupported` |
| enabled version | that version | that version |

Other FD store plugins serve the current version when `UCP-Agent` is missing; this plugin keeps its original `400`.

A checkout session or cart created for a declared version stays on it. A later request that declares a different version gets `422 version_unsupported`; a request whose profile cannot be resolved keeps the session's version. `lenient` deviates from the UCP spec on purpose: agents built before version negotiation keep working. Warnings are logged as JSON with the key `ucp_profile_resolution`. In `2026-01-23`, cart and catalog routes answer `404 capabilities_incompatible`.

**Complete checkout:** each `payment.instruments[]` entry carries a `credential`. With the Prism provider, `handler_id` is `xyz.fd.prism_payment`, `x402` or omitted; `type` is `x402`, `tokenized`, `default` or omitted; `credential.type` is `x402` or omitted. Any other value returns `422 invalid_instrument`, and the signed amount must still match the cart's Prism quote. A failed payment returns `422 payment_failed`; responses under 500 are cached per `Idempotency-Key` for 24 hours, so retry with a new key.

### ACP (Agent Commerce Protocol)

ACP is designed for **platform-to-merchant** interactions. It uses a session-based model where the platform manages the checkout flow.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/acp.json` | GET | Protocol discovery and capabilities |
| `/acp/checkout_sessions` | POST | Create checkout session |
| `/acp/checkout_sessions/:id` | GET | Retrieve checkout session |
| `/acp/checkout_sessions/:id` | POST | Update checkout session |
| `/acp/checkout_sessions/:id/complete` | POST | Complete checkout |
| `/acp/checkout_sessions/:id/cancel` | POST | Cancel checkout session |
| `/acp/orders/:id` | GET | Retrieve order |
| `/acp/product-feed` | GET | Retrieve product feed |

**Required headers:** `Authorization: Bearer <api_key>`, `API-Version`

## Payment Handlers

Payment is handled through a **pluggable adapter system**. Each adapter implements the `PaymentHandlerAdapter` interface and registers as a Medusa module.

### Using the Prism Payment Handler

For x402 stablecoin payments (USDC, FDUSD, etc.), use the companion package:

```bash
npm install @financedistrict/medusa-plugin-prism-payment
```

See [@financedistrict/medusa-plugin-prism-payment](../prism-payment/README.md) for setup instructions.

### Building a Custom Payment Handler

Implement the `PaymentHandlerAdapter` interface:

```typescript
import type {
  PaymentHandlerAdapter,
  CheckoutPrepareInput,
} from "@financedistrict/medusa-plugin-agentic-commerce"

export default class MyPaymentAdapter implements PaymentHandlerAdapter {
  readonly id = "my_payment_handler"
  readonly name = "My Payment"

  // Discovery — what to advertise in .well-known endpoints
  async getUcpDiscoveryHandlers(): Promise<Record<string, unknown[]>> {
    return {
      "com.example.my_payment": [{
        id: "my-handler",
        version: "1.0.0",
      }],
    }
  }

  async getAcpDiscoveryHandlers(): Promise<unknown[]> {
    return [{
      id: "com.example.my_payment",
      name: "My Payment",
      version: "1.0.0",
      psp: "my-psp",
      requires_delegate_payment: false,
      instrument_schemas: [/* ... */],
    }]
  }

  // Checkout preparation — called when a checkout session is created
  async prepareCheckoutPayment(input: CheckoutPrepareInput) {
    // Call your payment gateway, return config for the agent
    return { id: "my-handler", version: "1.0.0", config: { /* ... */ } }
  }

  // Response formatting — include payment config in checkout responses
  getUcpCheckoutHandlers(cartMetadata?: Record<string, unknown>) {
    return { /* ... */ }
  }

  getAcpCheckoutHandlers(cartMetadata?: Record<string, unknown>) {
    return [/* ... */]
  }
}
```

Register it as a Medusa module and reference it in `payment_handler_adapters`:

```typescript
// medusa-config.ts
modules: [
  {
    key: "myPaymentHandler",
    resolve: "./src/modules/my-payment-handler",
    options: { /* ... */ },
  },
  {
    key: "agenticCommerce",
    resolve: "@financedistrict/medusa-plugin-agentic-commerce/modules/agentic-commerce",
    options: {
      payment_handler_adapters: ["myPaymentHandler"],
      // ...
    },
  },
]
```

## Architecture

```
medusa-config.ts
  |
  +-- plugins: [@financedistrict/medusa-plugin-agentic-commerce]
  |     Routes, workflows, subscribers, jobs auto-discovered
  |
  +-- modules:
        +-- agenticCommerce (core service)
        |     Config, auth, formatting, payment registry
        |
        +-- prismPaymentHandler (optional adapter)
              Discovery, checkout-prepare, response formatting
```

### How Adapter Resolution Works

Medusa v2 modules have isolated DI containers. The plugin resolves payment handler adapters from the **request-scoped container** (`req.scope`) via middleware — not from the module's constructor. This ensures all modules are registered and accessible at request time.

```
Request → resolvePaymentAdapters middleware → route handler
              |
              +-- req.scope.resolve("prismPaymentHandler")
              +-- agenticCommerceService.resolveAdapters(req.scope)
```

## Workflows

The plugin provides four reusable workflows that orchestrate the checkout process:

| Workflow | Description |
|----------|-------------|
| `createCheckoutSessionWorkflow` | Validates cart, resolves region, prepares payment |
| `updateCheckoutSessionWorkflow` | Handles item/address changes, re-prepares payment |
| `completeCheckoutSessionWorkflow` | Completes payment, creates order |
| `cancelCheckoutSessionWorkflow` | Cancels session and releases resources |

Import them in your custom code:

```typescript
import {
  createCheckoutSessionWorkflow,
  completeCheckoutSessionWorkflow,
} from "@financedistrict/medusa-plugin-agentic-commerce/workflows"
```

## Configuration

### Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `api_key` | `string` | `""` | API key for ACP Bearer token authentication |
| `signatureKey` | `string` | `""` | HMAC-SHA256 key for request signing |
| `storefront_url` | `string` | `"http://localhost:8000"` | Public URL of your storefront |
| `store_name` | `string` | `"My Store"` | Store name in protocol responses |
| `store_description` | `string` | `""` | Store description for discovery |
| `payment_provider_id` | `string` | `"pp_system_default"` | Medusa payment provider ID |
| `payment_handler_adapters` | `string[]` | `[]` | Module keys of payment handler adapters |
| `ucp_version` | `string` | latest (`"2026-08-25"`) | Current UCP version, served when the agent declares none. Set `"2026-04-08"` to keep the root profile of 0.x releases |
| `ucp_supported_versions` | `string[]` | every known version except `ucp_version` | Further UCP versions served on request; the current version is removed from this list |
| `ucp_version_negotiation` | `"lenient" \| "strict"` | `"lenient"` | How an unusable agent profile is handled (see UCP above) |
| `acp_version` | `string` | `"2026-01-30"` | ACP protocol version to advertise |

An unknown version or negotiation value stops the store at boot.

### Environment Variables

| Variable | Maps to |
|----------|---------|
| `AGENTIC_COMMERCE_API_KEY` | `api_key` |
| `AGENTIC_COMMERCE_SIGNATURE_KEY` | `signatureKey` |
| `STOREFRONT_URL` | `storefront_url` |
| `AGENTIC_STORE_NAME` | `store_name` |
| `AGENTIC_STORE_DESCRIPTION` | `store_description` |
| `AGENTIC_PAYMENT_PROVIDER` | `payment_provider_id` |

## Exported Utilities

```typescript
import {
  // Service & module
  AgenticCommerceService,
  AgenticCommerceModule,
  AGENTIC_COMMERCE_MODULE,

  // Payment adapter interface
  PaymentHandlerAdapter,      // type
  CheckoutPrepareInput,       // type
  PaymentHandlerRegistry,

  // Error formatting
  formatAcpError,
  formatUcpError,

  // Address translation
  medusaToAcpAddress,
  acpAddressToMedusa,
  medusaToUcpAddress,
  ucpAddressToMedusa,

  // Status mapping
  resolveAcpStatus,
  resolveUcpStatus,
} from "@financedistrict/medusa-plugin-agentic-commerce"
```

## Protocol Compliance

Types and formatters are audited against the official protocol specifications:

- **UCP** [`2026-04-08`, `2026-08-25`](https://github.com/Universal-Commerce-Protocol/ucp) — catalog, cart, checkout, fulfillment, payment, order, discovery; [`2026-01-23`](https://github.com/Universal-Commerce-Protocol/ucp) — checkout, fulfillment, payment, order, discovery
- **ACP** [`2026-01-30`](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-01-30) — checkout sessions, delegate payment, capabilities

## Versioning

This package follows [semver](https://semver.org/). While pre-1.0:

- **Protocol spec changes** → minor bump (e.g., 0.1.x → 0.2.0)
- **Medusa compatibility changes** → patch bump (e.g., 0.1.0 → 0.1.1)
- **Bug fixes** → patch bump

The companion `@financedistrict/medusa-plugin-prism-payment` declares this package as a peer dependency with a `^` range (e.g., `^0.1.0`), so incompatible combinations are caught at install time.

## Requirements

- **Medusa v2** (2.x)
- **Node.js** >= 20
- **PostgreSQL** (standard Medusa requirement)

## License

MIT

---

<p align="center">
  Built by <a href="https://fd.xyz">Finance District</a>
</p>
