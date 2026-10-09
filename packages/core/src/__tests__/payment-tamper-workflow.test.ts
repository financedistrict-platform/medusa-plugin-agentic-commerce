import { describe, it, expect } from "vitest"
import { WorkflowManager } from "@medusajs/framework/orchestration"
import "../workflows/complete-checkout-session"

type FlowNode = { action?: string; next?: FlowNode | FlowNode[] }

function stepOrder(node: FlowNode | FlowNode[] | undefined): string[] {
  if (!node) return []
  return (Array.isArray(node) ? node : [node]).flatMap((n) => [
    ...(n.action ? [n.action] : []),
    ...stepOrder(n.next),
  ])
}

describe("UCP completion holds the cart lock from the total check to the order", () => {
  const workflow = WorkflowManager.getWorkflow("complete-checkout-session") as unknown as { flow_: FlowNode }
  const steps = stepOrder(workflow.flow_)
  const at = (action: string) => {
    const index = steps.indexOf(action)
    expect(index, `${action} in ${steps.join(" > ")}`).toBeGreaterThanOrEqual(0)
    return index
  }

  it("takes the cart lock in this workflow, since a nested cart completion skips its own lock", () => {
    expect(at("acquire-lock-step")).toBeLessThan(at("setup-payment"))
    expect(at("setup-payment")).toBeLessThan(at("complete-cart-as-step"))
  })

  it("binds the authorization to the cart under the lock, before any payment session or order is created", () => {
    expect(at("acquire-lock-step")).toBeLessThan(at("reserve-payment-authorization"))
    expect(at("reserve-payment-authorization")).toBeLessThan(at("setup-payment"))
    expect(at("reserve-payment-authorization")).toBeLessThan(at("complete-cart-as-step"))
  })

  it("adds shipping and creates the payment collection before the lock, since both take the cart lock themselves", () => {
    expect(at("ensure-shipping-method")).toBeLessThan(at("acquire-lock-step"))
    expect(at("ensure-payment-collection")).toBeLessThan(at("acquire-lock-step"))
  })

  it("releases the cart lock only after the payment is captured", () => {
    expect(at("capture-payment-workflow-as-step")).toBeLessThan(at("release-lock-step"))
  })
})
