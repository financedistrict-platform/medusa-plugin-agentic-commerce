<h1 align="center">@financedistrict/medusa-plugin-prism-payment</h1>

<p align="center">
  x402 stablecoin payments for Medusa v2.<br />
  AI agents pay with <strong>USDC</strong>, <strong>FDUSD</strong>, and other stablecoins via EIP-3009 authorizations — settled on Base through the <a href="https://fd.xyz">Prism Gateway</a>.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#api">API</a>
</p>

---

## What This Does

This package provides two Medusa v2 modules:

1. **Payment Handler Adapter** — Integrates with [@financedistrict/medusa-plugin-agentic-commerce](../core/README.md) to advertise x402 payment capabilities in discovery endpoints and prepare checkout sessions with Prism payment requirements.

2. **Payment Provider** — A standard Medusa payment provider that settles x402 authorizations through the Prism Gateway. Handles authorization verification, capture, and refunds.

## Quick Start

### 1. Install

```bash
npm install @financedistrict/medusa-plugin-prism-payment
```

> **Prerequisite:** You also need the core plugin installed:
> ```bash
> npm install @financedistrict/medusa-plugin-agentic-commerce
> ```

### 2. Configure `medusa-config.ts`

```typescript
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  plugins: [
    {
      resolve: "@financedistrict/medusa-plugin-agentic-commerce",
      options: {},
    },
  ],
  modules: [
    // 1. Prism payment handler adapter (for agent discovery + checkout prep)
    {
      key: "prismPaymentHandler",
      resolve: "@financedistrict/medusa-plugin-prism-payment/modules/prism-payment-handler",
      options: {
        api_url: process.env.PRISM_API_URL || "https://prism-gw.fd.xyz",
        api_key: process.env.PRISM_API_KEY,
      },
    },

    // 2. Prism payment provider (for Medusa's payment flow)
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@financedistrict/medusa-plugin-prism-payment/modules/prism-payment",
            id: "prism",
            options: {
              api_url: process.env.PRISM_API_URL || "https://prism-gw.fd.xyz",
              api_key: process.env.PRISM_API_KEY,
            },
          },
        ],
      },
    },

    // 3. Core agentic commerce service (references the adapter above)
    {
      key: "agenticCommerce",
      resolve: "@financedistrict/medusa-plugin-agentic-commerce/modules/agentic-commerce",
      options: {
        api_key: process.env.AGENTIC_COMMERCE_API_KEY,
        storefront_url: process.env.STOREFRONT_URL,
        store_name: "Your Store",
        payment_handler_adapters: ["prismPaymentHandler"],
      },
    },
  ],
})
```

### 3. Set Environment Variables

```bash
PRISM_API_KEY=your-prism-merchant-api-key
PRISM_API_URL=https://prism-gw.fd.xyz   # optional, this is the default
```

### 4. Verify

Start your store and check the discovery endpoint:

```bash
curl http://localhost:9000/.well-known/ucp | jq '.ucp.payment_handlers'
```

You should see:

```json
{
  "xyz.fd.prism_payment": [
    {
      "id": "x402",
      "version": "2026-01-15"
    }
  ]
}
```

## How It Works

### Payment Flow

```
Agent                    Medusa + Plugin              Prism Gateway
  |                           |                            |
  |  POST /ucp/checkout-sessions                           |
  |  (create checkout)        |                            |
  |-------------------------->|                            |
  |                           |  POST /checkout-prepare    |
  |                           |  (get x402 requirements)   |
  |                           |--------------------------->|
  |                           |  { accepts: [USDC, ...] }  |
  |                           |<---------------------------|
  |  { payment_handlers: {    |                            |
  |      config: { accepts }  |                            |
  |    }                      |                            |
  |  }                        |                            |
  |<--------------------------|                            |
  |                           |                            |
  |  POST /complete           |                            |
  |  { authorization: "0x.." }|                            |
  |-------------------------->|                            |
  |                           |  POST /settle              |
  |                           |  (submit EIP-3009 auth)    |
  |                           |--------------------------->|
  |                           |  { tx_hash: "0x..." }      |
  |                           |<---------------------------|
  |  { order_id: "..." }      |                            |
  |<--------------------------|                            |
```

### x402 Protocol

[x402](https://x402.org) is an open standard for machine-to-machine payments. It uses EIP-3009 `transferWithAuthorization` to enable gasless, pre-signed stablecoin transfers:

1. **Agent signs** an EIP-3009 authorization (off-chain, no gas)
2. **Merchant submits** the authorization to the Prism Gateway
3. **Prism settles** the transfer on-chain (Base network)

The agent never needs to hold ETH for gas. The merchant receives stablecoins directly.

## Modules

### Payment Handler Adapter

**Module key:** `prismPaymentHandler`

Implements the `PaymentHandlerAdapter` interface from the core plugin:

| Method | Purpose |
|--------|---------|
| `getUcpDiscoveryHandlers()` | Returns Prism handler entries for `/.well-known/ucp` |
| `getAcpDiscoveryHandlers()` | Returns Prism handler entries for `/.well-known/acp.json` |
| `prepareCheckoutPayment()` | Calls Prism `checkout-prepare` to get x402 requirements |
| `getUcpCheckoutHandlers()` | Formats Prism config for UCP checkout session responses |
| `getAcpCheckoutHandlers()` | Formats Prism config for ACP checkout session responses |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `api_url` | `string` | `"https://prism-gw.fd.xyz"` | Prism Gateway API base URL |
| `api_key` | `string` | `""` | Merchant API key from Prism Console |

### Payment Provider

**Provider ID:** `pp_prism_prism`

A standard Medusa v2 payment provider that handles the settlement side:

| Operation | Description |
|-----------|-------------|
| `initiatePayment` | Creates a pending payment session |
| `authorizePayment` | Verifies the x402 authorization via Prism |
| `capturePayment` | Settles the authorization on-chain via Prism |
| `refundPayment` | Initiates refund through Prism |
| `cancelPayment` | Cancels the payment session |

## Configuration

### Prism Gateway

The Prism Gateway is the settlement layer. It:

- Validates EIP-3009 authorizations
- Submits transactions to Base (L2)
- Handles gas sponsorship
- Provides merchant settlement analytics

Get your API key at [prism.fd.xyz](https://prism.fd.xyz).

### Supported Assets

| Token | Network | Chain ID (CAIP-2) |
|-------|---------|-------------------|
| USDC | Base | `eip155:8453` |
| FDUSD | Base | `eip155:8453` |

Additional tokens and networks can be configured through the Prism Console.

## Exports

```typescript
import {
  // Payment handler adapter
  PrismPaymentHandlerModule,
  PRISM_PAYMENT_HANDLER_MODULE,
  PrismPaymentHandlerAdapter,
  PRISM_CHECKOUT_CONFIG_KEY,

  // Payment provider
  PrismPaymentProvider,

  // Prism client (for custom integrations)
  PrismClient,

  // Types
  PrismPaymentConfig,
  X402PaymentAuthorization,
  Eip3009Authorization,
  PRISM_HANDLER_ID,
  PRISM_INSTRUMENT_SCHEMA,
} from "@financedistrict/medusa-plugin-prism-payment"
```

## Requirements

- **Medusa v2** (2.x)
- **@financedistrict/medusa-plugin-agentic-commerce** (peer dependency)
- **Prism Gateway API key** from [prism.fd.xyz](https://prism.fd.xyz)

## License

MIT

---

<p align="center">
  Built by <a href="https://fd.xyz">Finance District</a>
</p>
