import { agentPaymentCredential, type AgentPaymentCredential } from "./agent-payment-credential"

export type ExtractedPayment = {
  credential: AgentPaymentCredential
  x402Version?: number
  handlerId?: string
  instrumentType?: string
}

export type UcpPaymentExtraction =
  | { ok: true; payment: ExtractedPayment }
  | { ok: false; code: "missing_payment" | "conflicting_credential" }

export function extractUcpPayment(body: Record<string, unknown>): UcpPaymentExtraction {
  const payment = body?.payment as { instruments?: Record<string, unknown>[] } | undefined
  const instrument = payment?.instruments?.[0]
  const credential = instrument?.credential as Record<string, unknown> | undefined
  if (!instrument || !credential) return { ok: false, code: "missing_payment" }

  const hasAuthorization = credential.authorization !== undefined
  const hasPaymentPayload = credential.paymentPayload !== undefined
  if (hasAuthorization && hasPaymentPayload) return { ok: false, code: "conflicting_credential" }

  const settlement = settlementFor(credential, hasPaymentPayload)
  if (!settlement) return { ok: false, code: "missing_payment" }

  return {
    ok: true,
    payment: {
      credential: agentPaymentCredential(settlement.authorization),
      x402Version: settlement.x402Version,
      handlerId: instrument.handler_id as string | undefined,
      instrumentType: instrument.type as string | undefined,
    },
  }
}

function settlementFor(
  credential: Record<string, unknown>,
  hasPaymentPayload: boolean,
): { authorization: string; x402Version?: number } | null {
  if (hasPaymentPayload) {
    return {
      authorization: Buffer.from(JSON.stringify(credential)).toString("base64"),
      x402Version: (credential.x402Version ?? credential.x402_version ?? 2) as number,
    }
  }
  if (typeof credential.authorization === "string" && credential.authorization.length > 0) {
    return {
      authorization: credential.authorization,
      x402Version: credential.x402_version as number | undefined,
    }
  }
  return null
}
