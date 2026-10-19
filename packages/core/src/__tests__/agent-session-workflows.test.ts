import { describe, it, expect } from "vitest"
import { WorkflowManager } from "@medusajs/framework/orchestration"
import "../workflows/create-checkout-session"
import "../workflows/cancel-checkout-session"
import "../workflows/complete-checkout-session"
import "../workflows/update-checkout-session"
import { assertSessionMutable, sessionLockedCodeOf } from "../workflows/steps/assert-session-mutable"
import { fakeAgentSessions } from "./helpers/agent-session-store"

type FlowNode = { action?: string; next?: FlowNode | FlowNode[] }

function stepOrder(node: FlowNode | FlowNode[] | undefined): string[] {
  if (!node) return []
  return (Array.isArray(node) ? node : [node]).flatMap((n) => [...(n.action ? [n.action] : []), ...stepOrder(n.next)])
}

function stepsOf(workflowId: string) {
  const workflow = WorkflowManager.getWorkflow(workflowId) as unknown as { flow_: FlowNode }
  return stepOrder(workflow.flow_)
}

describe("session state is written by the server, not into cart metadata", () => {
  it("opens the agent session right after the cart is created", () => {
    const steps = stepsOf("create-checkout-session")
    expect(steps).toContain("open-agent-session")
    expect(steps.indexOf("create-cart-workflow-as-step")).toBeLessThan(steps.indexOf("open-agent-session"))
  })

  it("records a cancellation in the agent session instead of cart metadata", () => {
    const steps = stepsOf("cancel-checkout-session")
    expect(steps).toContain("cancel-agent-session")
    expect(steps).not.toContain("update-cart-workflow-as-step")
  })

  it("holds the cart lock while recording a cancellation so it cannot interleave with a completion", () => {
    const steps = stepsOf("cancel-checkout-session")
    expect(steps.indexOf("acquire-lock-step")).toBeGreaterThanOrEqual(0)
    expect(steps.indexOf("acquire-lock-step")).toBeLessThan(steps.indexOf("cancel-agent-session"))
    expect(steps.indexOf("cancel-agent-session")).toBeLessThan(steps.indexOf("release-lock-step"))
  })
})

describe("a completed checkout is refused before any payment is touched", () => {
  it("validates the checkout before it reserves or sets up a payment", () => {
    const steps = stepsOf("complete-checkout-session")
    expect(steps.indexOf("validate-checkout-prerequisites")).toBe(0)
    expect(steps.indexOf("validate-checkout-prerequisites")).toBeLessThan(steps.indexOf("reserve-payment-authorization"))
    expect(steps.indexOf("validate-checkout-prerequisites")).toBeLessThan(steps.indexOf("setup-payment"))
  })
})

describe("an unsupported currency is refused before the cart is created", () => {
  it("validates the currency ahead of the cart creation", () => {
    const steps = stepsOf("create-checkout-session")
    expect(steps.indexOf("validate-currency")).toBe(0)
    expect(steps.indexOf("validate-currency")).toBeLessThan(steps.indexOf("create-cart-as-step"))
  })
})

describe("a completion records its settlement under the cart lock", () => {
  it("guards, reserves, sets up, marks the settlement, completes, captures and clears before the lock is released", () => {
    const steps = stepsOf("complete-checkout-session")
    const order = [
      "acquire-lock-step",
      "guard-pending-settlement",
      "reserve-payment-authorization",
      "setup-payment",
      "begin-settlement-attempt",
      "complete-cart-as-step",
      "capture-payment-workflow-as-step",
      "clear-settlement-attempt",
      "release-lock-step",
    ]
    const positions = order.map((action) => steps.indexOf(action))

    expect(positions.every((position) => position >= 0), steps.join(" > ")).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})

describe("update and cancel wait for an open settlement", () => {
  it("holds the cart lock for the whole update", () => {
    const steps = stepsOf("update-checkout-session")
    expect(steps[0]).toBe("acquire-lock-step")
    expect(steps[1]).toBe("assert-session-mutable")
    expect(steps[steps.length - 1]).toBe("release-lock-step")
  })

  it("checks the session under the lock before a cancellation", () => {
    const steps = stepsOf("cancel-checkout-session")
    expect(steps.indexOf("acquire-lock-step")).toBeLessThan(steps.indexOf("assert-session-mutable"))
    expect(steps.indexOf("assert-session-mutable")).toBeLessThan(steps.indexOf("cancel-agent-session"))
  })

  const marker = (state: "settling" | "pending" | "review") => ({
    state,
    credential_sha256: "d1",
    resumed: false,
    started_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
  })

  const assertWith = (cart: Record<string, unknown> | undefined, session: Record<string, unknown> = {}) => {
    const services: Record<string, unknown> = {
      query: { graph: async () => ({ data: cart ? [cart] : [] }) },
      agenticCommerceSession: fakeAgentSessions([{ cart_id: "cart_1", ...session }]),
    }
    return assertSessionMutable({ cart_id: "cart_1" }, { resolve: (name: string) => services[name] })
  }

  it.each([
    ["a settling payment", {}, { pending_settlement: marker("settling") }, "session_complete_in_progress"],
    ["a pending payment", {}, { pending_settlement: marker("pending") }, "session_complete_in_progress"],
    ["a payment held for review", {}, { pending_settlement: marker("review") }, "session_requires_escalation"],
    ["a completed checkout", { completed_at: "2026-10-19T00:00:00Z" }, {}, "session_completed"],
    ["a canceled checkout", {}, { canceled_at: "2026-10-19T00:00:00Z" }, "session_canceled"],
  ])("refuses to change %s", async (_label, cart, session, code) => {
    const error = await assertWith({ id: "cart_1", ...cart }, session).catch((caught: unknown) => caught)

    expect(sessionLockedCodeOf(error)).toBe(code)
  })

  it("lets an open checkout change", async () => {
    await expect(assertWith({ id: "cart_1", completed_at: null })).resolves.toBeUndefined()
  })

  it("reports a missing cart as not found", async () => {
    await expect(assertWith(undefined)).rejects.toThrow("Cart cart_1 not found")
  })
})
