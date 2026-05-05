# Contributing

Thanks for considering a contribution. This project is MIT-licensed and built to be open: anyone can build a payment handler, anyone can fork and self-host.

## Getting oriented

- **[Wiki](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki)** — architecture, integration guides, handler authoring
- **[Quick Start](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Quick-Start)** — get running locally
- **[Architecture](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Architecture)** — the gateway pattern and design framing

## Reporting issues

[File an issue](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/issues). Useful info:
- What you ran (which packages, which versions, what `medusa-config.ts` shape)
- What you expected
- What happened (logs, response bodies, screenshots)
- Whether it reproduces consistently

If you're hitting a plugin bug that's clearly the plugin's fault and you have a fix, a PR is welcome — see below.

## Pull requests

Small + focused is best. Some guidance:

- **One concern per PR.** A PR that fixes a bug *and* refactors three files is hard to review and risky to land.
- **Tests.** If you're changing behavior, exercise the new code path. The repo has lighter test coverage than ideal — adding tests around your change is a good complement.
- **Run the build.** `npm run build` should pass. CI will catch this anyway, but locally is faster.
- **Add a changeset.** If your PR changes a published package, run `npm run changeset` and commit the generated `.changeset/*.md` file. Pick the bump type (patch/minor/major) per package and write a one-line summary — that summary lands in the CHANGELOG. Don't edit `package.json` versions directly; the release workflow does that.

### Release flow (automated)

Releases run via [Changesets](https://github.com/changesets/changesets) and the GitHub Action in `.github/workflows/release.yml`:

1. Each PR that changes a published package adds a changeset.
2. On merge to `main`, the workflow opens (or updates) a `chore: version packages` PR that consumes the changesets, bumps versions, and updates CHANGELOGs.
3. Merging that PR triggers `changeset publish` and the packages go to npm.

If you're a maintainer and need to release manually (rare), run `npm run version-packages` then `npm run release` locally with a valid `NPM_TOKEN`.

### Protocol-bump policy

When changing a UCP/ACP protocol type that ripples through both `core` and the handler packages, write a changeset that bumps **all** affected packages together (typically `minor` while pre-1.0). The changeset CLI lets you select multiple packages in one entry — use that.

For larger changes, open an issue first to discuss the direction. Saves both sides time.

## Building a handler package

If you're shipping your own payment handler (Stripe, Klarna, anything), it doesn't go in this repo — it lives in your own. See the **[Build a Handler](https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce/wiki/Build-a-Handler)** wiki page for the conventions, the `PaymentHandlerAdapter` interface, and the module wrapper pattern.

The `@financedistrict/medusa-plugin-prism-payment` package in this repo is the reference implementation. Handlers built outside this repo work the same way — register as a Medusa module, reference in `payment_handler_adapters`, no plugin-side changes needed.

## Local development

```bash
git clone https://github.com/financedistrict-platform/medusa-plugin-agentic-commerce.git
cd medusa-plugin-agentic-commerce
npm install
npm run build
```

To work on the plugin alongside a Medusa store, use `npm pack` and install the resulting tarball into your store's `node_modules`, or use `npm link` from the store side.

## Code of Conduct

By participating, you agree to abide by the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Report concerns to `developers@fd.xyz`.

## Roadmap

The highest-leverage contributions today:
- **New handler packages** (Stripe, Klarna, etc.) shipped from your own repos
- **Tests** — a Vitest scaffold is on the roadmap; until it lands, integration testing happens against a live Medusa store
- **Documentation** — wiki pages on edge cases, troubleshooting, integration patterns
