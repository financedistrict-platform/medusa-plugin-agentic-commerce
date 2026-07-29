---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

fix(packaging): expose ./admin subpath in exports map

Medusa's admin bundler resolves plugin admin extensions by importing
`<package-name>/admin`. The exports map was missing this entry, so the
bundler silently skipped all admin UI (settings page, dashboard stats
widget, order agent badge). Added `./admin` with import/default/require
conditions matching the @medusajs/draft-order reference implementation.
