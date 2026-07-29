---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

fix: add ./admin entry to package exports

Missing ./admin in the exports map caused Medusa's admin bundler to
silently skip the plugin's admin UI.
