import { describe, it, expect } from "vitest"
import { WorkflowManager } from "@medusajs/framework/orchestration"
import "../workflows/create-checkout-session"
import "../workflows/cancel-checkout-session"

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
