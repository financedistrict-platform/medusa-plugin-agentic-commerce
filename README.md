# medusa-plugin-agentic-commerce

[![CI](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/actions/workflows/ci.yml/badge.svg)](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/actions/workflows/ci.yml)
[![Release](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/actions/workflows/release.yml/badge.svg)](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/actions/workflows/release.yml)
[![npm: agentic-commerce](https://img.shields.io/npm/v/@financedistrict/medusa-plugin-agentic-commerce?label=agentic-commerce)](https://www.npmjs.com/package/@financedistrict/medusa-plugin-agentic-commerce)
[![npm: prism-payment](https://img.shields.io/npm/v/@financedistrict/medusa-plugin-prism-payment?label=prism-payment)](https://www.npmjs.com/package/@financedistrict/medusa-plugin-prism-payment)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Make your Medusa v2 store shoppable by AI agents.

This plugin adds [UCP](https://ucp.dev/) and [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) protocol endpoints to your Medusa backend, so AI shopping agents can discover your products, create checkouts, and complete purchases — through standard HTTP APIs that require no frontend at all.

> **[→ Get started in under 10 minutes (Wiki: Quick Start)](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Quick-Start)**

## Why this matters

AI agents are becoming the next commerce channel. Just like merchants once added mobile apps alongside their websites, they'll soon need to serve autonomous agents that shop on behalf of consumers. But agents don't browse — they need structured APIs with standardized discovery, checkout flows, and payment settlement.

**UCP** (Universal Commerce Protocol) and **ACP** (Agentic Commerce Protocol) are the emerging open standards for this. This plugin implements both as native Medusa v2 modules, so your store speaks the language agents understand.

## What you get

- **Agent discovery** — `/.well-known/ucp` and `/.well-known/acp.json` endpoints that tell agents what your store supports, which payment methods are available, and where the API lives
- **Product search** — Full-text catalog search and direct product lookup, designed for machine consumption
- **Checkout sessions** — Agents can create carts, set shipping addresses, select delivery options, and complete purchases through protocol-compliant endpoints
- **Pluggable payments** — Ships with [Finance District Prism](https://developers.fd.xyz/prism) for stablecoin payments (x402/EIP-3009), or implement your own payment handler
- **Order tracking** — Agents can retrieve order status and details after purchase
- **No frontend changes** — Everything runs in the Medusa backend as a standard v2 plugin + module
- **Zero custom code** — Install, configure, start. No route files to create, no middleware to write

## Packages

| Package | What it does |
|---------|-------------|
| [`@financedistrict/medusa-plugin-agentic-commerce`](./packages/core) | Core plugin — UCP + ACP protocol endpoints, checkout workflows, payment adapter system |
| [`@financedistrict/medusa-plugin-prism-payment`](./packages/prism-payment) | Prism payment handler — stablecoin settlement via x402/EIP-3009 |

## Documentation

The [wiki](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki) is the canonical reference. Highlights:

- **[Quick Start](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Quick-Start)** — go from `npm install` to a discoverable store in under 10 minutes
- **[Architecture](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Architecture)** — the gateway pattern and how the plugin sits inside Medusa
- **[Build a Handler](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Build-a-Handler)** — author your own payment handler package
- **[UCP and ACP](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/UCP-and-ACP)** — protocol overview, what we support
- **[Authentication](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Authentication)** — every token in the system, who issues it, where it goes
- **[Glossary](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Glossary)** — terminology

## Versioning & Releases

Both packages follow [semver](https://semver.org/). Releases are automated via [Changesets](https://github.com/changesets/changesets) — see [CONTRIBUTING.md](CONTRIBUTING.md#release-flow-automated) for the flow.

## Requirements

- **Medusa v2** (2.x)
- **Node.js** >= 20

## Contributing

Issues and pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the basics and the [wiki](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki) for architecture and integration guides.

If you're shipping a new payment handler package, you don't need to fork or PR this repo — handler packages live in their own repos and self-register at module load. See the [Build a Handler](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Build-a-Handler) wiki page.

## License

[MIT](LICENSE) © Finance District.
