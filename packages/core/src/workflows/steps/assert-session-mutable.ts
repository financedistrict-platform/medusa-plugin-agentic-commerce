import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { agentSessions } from "../../lib/agent-session"
import { resolveUcpStatus, type UcpStatus } from "../../lib/status-maps"

const LOCKED_STATUSES = ["complete_in_progress", "requires_escalation", "completed", "canceled"] as const

type LockedStatus = (typeof LOCKED_STATUSES)[number]

export type SessionLockedCode = `session_${LockedStatus}`

const LOCKED_MESSAGES: Record<LockedStatus, string> = {
  complete_in_progress: "The checkout session cannot change while its payment is settling.",
  requires_escalation: "The checkout session cannot change while its payment is held for review.",
  completed: "The checkout session is already completed.",
  canceled: "The checkout session is canceled.",
}

export class SessionLockedError extends MedusaError {
  constructor(code: SessionLockedCode) {
    super(MedusaError.Types.NOT_ALLOWED, LOCKED_MESSAGES[code.slice("session_".length) as LockedStatus], code)
  }
}

export function sessionLockedCodeOf(error: unknown): SessionLockedCode | null {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  return LOCKED_STATUSES.some((status) => `session_${status}` === code) ? (code as SessionLockedCode) : null
}

function isLocked(status: UcpStatus): status is LockedStatus {
  return (LOCKED_STATUSES as readonly string[]).includes(status)
}

type Resolver = { resolve: (name: string) => unknown }

type Query = { graph(input: unknown): Promise<{ data: { id: string; completed_at?: string | Date | null }[] }> }

export async function assertSessionMutable(input: { cart_id: string }, container: Resolver): Promise<void> {
  const query = container.resolve("query") as Query
  const { data: [cart] } = await query.graph({ entity: "cart", fields: ["id", "completed_at"], filters: { id: input.cart_id } })
  if (!cart) throw new Error(`Cart ${input.cart_id} not found`)

  const status = resolveUcpStatus({ completed_at: cart.completed_at, agent_session: await agentSessions(container).find(input.cart_id) })
  if (isLocked(status)) throw new SessionLockedError(`session_${status}`)
}

export const assertSessionMutableStep = createStep(
  "assert-session-mutable",
  async (input: { cart_id: string }, { container }) => {
    await assertSessionMutable(input, container)
    return new StepResponse({ cart_id: input.cart_id })
  },
)
