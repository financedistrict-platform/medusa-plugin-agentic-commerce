import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { agentSessions } from "../../lib/agent-session"
import { settlementAfterFailure, type FailedPaymentSession } from "../../lib/settlement-after-failure"
import { credentialDigestOf, type GuardPendingSettlementInput } from "./guard-pending-settlement"

export type BeginSettlementAttemptInput = GuardPendingSettlementInput & { resumed: boolean }

export type SettlementAttempt = {
  cart_id: string
  credential_sha256: string | null
  resumed: boolean
}

type Resolver = { resolve: (name: string) => unknown }

type PaymentSessionRow = { id?: string; status?: string | null; data?: Record<string, unknown> | null } | null

type Query = { graph(input: unknown): Promise<{ data: { payment_collection?: { payment_sessions?: PaymentSessionRow[] } | null }[] }> }

export async function beginSettlementAttempt(
  input: BeginSettlementAttemptInput,
  container: Resolver,
  now: Date = new Date(),
): Promise<SettlementAttempt> {
  const attempt = { cart_id: input.cart_id, credential_sha256: credentialDigestOf(input.payment_data), resumed: input.resumed }
  const at = now.toISOString()
  await agentSessions(container).setPendingSettlement(input.cart_id, {
    state: "settling",
    credential_sha256: attempt.credential_sha256,
    resumed: attempt.resumed,
    started_at: at,
    provider_called_at: null,
    updated_at: at,
  })
  return attempt
}

async function paymentSessionFor(container: Resolver, attempt: SettlementAttempt): Promise<FailedPaymentSession | null> {
  if (!attempt.credential_sha256) return null
  const query = container.resolve("query") as Query
  const { data: [cart] } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id: attempt.cart_id },
  })
  const match = (cart?.payment_collection?.payment_sessions ?? []).find(
    (session) => session?.data?.credential_sha256 === attempt.credential_sha256,
  )
  return match ? { status: match.status ?? null, data: match.data ?? null } : null
}

export async function compensateSettlementAttempt(
  attempt: SettlementAttempt,
  container: Resolver,
  now: Date = new Date(),
): Promise<void> {
  const sessions = agentSessions(container)
  try {
    const marker = (await sessions.find(attempt.cart_id))?.pending_settlement
    const paymentSession = await paymentSessionFor(container, attempt).catch((error: unknown) => {
      console.error(`[agentic-commerce] Could not read the payment sessions of cart ${attempt.cart_id}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    })
    const outcome = settlementAfterFailure(
      paymentSession,
      { credential_sha256: attempt.credential_sha256, transaction: marker?.transaction ?? null, provider_called_at: marker?.provider_called_at ?? null },
      attempt.resumed,
    )
    if (outcome.kind === "clear") {
      await sessions.setPendingSettlement(attempt.cart_id, null)
      return
    }
    await sessions.setPendingSettlement(attempt.cart_id, {
      state: outcome.kind,
      credential_sha256: attempt.credential_sha256,
      resumed: attempt.resumed,
      started_at: marker?.started_at ?? now.toISOString(),
      transaction: outcome.transaction ?? null,
      reason: outcome.reason ?? null,
      provider_called_at: marker?.provider_called_at ?? null,
      updated_at: now.toISOString(),
    })
  } catch (error: unknown) {
    console.error(`[agentic-commerce] Could not record the settlement state of cart ${attempt.cart_id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const beginSettlementAttemptStep = createStep(
  "begin-settlement-attempt",
  async (input: BeginSettlementAttemptInput, { container }) => {
    const attempt = await beginSettlementAttempt(input, container)
    return new StepResponse(attempt, attempt)
  },
  async (attempt: SettlementAttempt | undefined, { container }) => {
    if (!attempt) return
    await compensateSettlementAttempt(attempt, container)
  },
)
