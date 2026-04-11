# Medusa Agentic Commerce

Turn any Medusa v2 store into an AI-native storefront.

This monorepo contains two publishable packages:

| Package | Description |
|---------|-------------|
| [`@financedistrict/medusa-plugin-agentic-commerce`](./packages/core/) | Core plugin — UCP + ACP protocol endpoints, checkout workflows, payment adapter system |
| [`@financedistrict/medusa-plugin-prism-payment`](./packages/prism-payment/) | Prism x402 payment handler — stablecoin payments via EIP-3009 authorizations |

## Get Started

```bash
npm install @financedistrict/medusa-plugin-agentic-commerce
npm install @financedistrict/medusa-plugin-prism-payment  # optional, for x402 payments
```

See the [core plugin README](./packages/core/README.md) for full setup instructions.

## Development

```bash
# Build both packages
cd packages/core && npx medusa plugin:build
cd packages/prism-payment && npx medusa plugin:build

# Pack for local testing
cd packages/core && npm pack
cd packages/prism-payment && npm pack
```

## License

MIT — Built by [Finance District](https://fd.xyz)
