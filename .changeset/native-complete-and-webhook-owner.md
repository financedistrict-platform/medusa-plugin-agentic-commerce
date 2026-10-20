---
"@financedistrict/medusa-plugin-agentic-commerce": patch
---

Medusa's own cart completion now refuses an agent cart: a `completeCartWorkflow` validate hook lets it complete only inside the agent checkout completion. Agent webhooks go only to the URL stored on the agent session (never to a URL in cart metadata), and no webhook is sent when no signing key is set. An ACP checkout session owned by another agent now answers 404, the same as a missing session.
