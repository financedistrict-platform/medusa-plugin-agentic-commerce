import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Badge, Text, Copy } from "@medusajs/ui"
import { useEffect, useState } from "react"

type AdminOrder = {
  id: string
  cart_id?: string
}

type DetailWidgetProps = {
  data: AdminOrder
}

type CartMetadata = {
  protocol_type?: string
  agent_identifier?: string
  agent_webhook_url?: string
  payment_method?: string
  payment_amount?: string
  payment_currency?: string
  agent_webhook_log?: Array<{
    event: string
    status: number
    success: boolean
    sent_at: string
  }>
}

const OrderAgentBadge = ({ data }: DetailWidgetProps) => {
  const [metadata, setMetadata] = useState<CartMetadata | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!data.cart_id) {
      setLoading(false)
      return
    }

    fetch(`/admin/agentic-commerce/cart-metadata/${data.cart_id}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setMetadata(json?.metadata || null))
      .catch(() => setMetadata(null))
      .finally(() => setLoading(false))
  }, [data.cart_id])

  if (loading) return null
  if (!metadata?.protocol_type) return <></>

  const lastWebhook = metadata.agent_webhook_log?.slice(-1)[0]

  return (
    <Container className="mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Text size="large" weight="plus">
          Agent Commerce Order
        </Text>
        <Badge color="purple">{metadata.protocol_type?.toUpperCase()}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
        <Text className="text-ui-fg-subtle">Protocol</Text>
        <Text>{metadata.protocol_type?.toUpperCase()}</Text>

        <Text className="text-ui-fg-subtle">Agent</Text>
        <Text>{metadata.agent_identifier || "unknown"}</Text>

        <Text className="text-ui-fg-subtle">Session</Text>
        <div className="flex items-center gap-1">
          <Text className="font-mono text-xs">
            {data.cart_id ? `${data.cart_id.slice(0, 12)}...` : "—"}
          </Text>
          {data.cart_id && <Copy content={data.cart_id} />}
        </div>

        {metadata.payment_method && (
          <>
            <Text className="text-ui-fg-subtle">Payment</Text>
            <Text>
              {metadata.payment_method === "x402" ? "x402" : metadata.payment_method}
              {metadata.payment_amount && metadata.payment_currency
                ? ` — ${metadata.payment_amount} ${metadata.payment_currency.toUpperCase()}`
                : ""}
            </Text>
          </>
        )}

        {metadata.agent_webhook_url && (
          <>
            <Text className="text-ui-fg-subtle">Webhook</Text>
            <div className="flex items-center gap-1">
              <Text className="font-mono text-xs truncate max-w-[200px]">
                {metadata.agent_webhook_url}
              </Text>
              {lastWebhook && (
                <Badge color={lastWebhook.success ? "green" : "red"} size="2xsmall">
                  {lastWebhook.success ? "OK" : `${lastWebhook.status}`}
                </Badge>
              )}
            </div>
          </>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.before",
})

export default OrderAgentBadge
