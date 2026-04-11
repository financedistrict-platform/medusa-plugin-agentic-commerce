<h1 align="center">@financedistrict/medusa-plugin-agentic-commerce</h1>

<p align="center">
  Turn any Medusa v2 store into an AI-native storefront.<br />
  Adds <strong>UCP</strong> and <strong>ACP</strong> protocol endpoints so AI agents can discover products, check out, pay, and track orders — all through standard HTTP APIs.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#protocols">Protocols</a> &middot;
  <a href="#api-reference">API Reference</a> &middot;
  <a href="#payment-handlers">Payment Handlers</a> &middot;
  <a href="#configuration">Configuration</a>
</p>

---

## Why

AI agents are becoming a real commerce channel. They need machine-readable APIs to browse catalogs, fill carts, handle payments, and confirm orders — without scraping HTML or reverse-engineering checkout flows.

This plugin gives your Medusa store a **standards-compliant agent API** in minutes. No custom code, no frontend changes. And the **pluggable payment handler adapter system** means any payment method — stablecoins, cards, wallets — can be added without modifying the core plugin.

## What You Get

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
| `/.well-known/ucp` | GET | Protocol discovery and capabilities |
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
| `ucp_version` | `string` | `"2026-01-11"` | UCP protocol version to advertise |
| `acp_version` | `string` | `"2026-01-30"` | ACP protocol version to advertise |

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

## Requirements

- **Medusa v2** (2.x)
- **Node.js** 20+
- **PostgreSQL** (standard Medusa requirement)

## License

MIT

---

<p align="center">
  Built by <a href="https://fd.xyz">Finance District</a>
</p>
