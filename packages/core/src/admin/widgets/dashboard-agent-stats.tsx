import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge } from "@medusajs/ui"
import { useEffect, useState } from "react"

type AnalyticsData = {
  period: string
  orders: number
  revenue: number
  currency: string
  conversion_rate: number
  sessions_created: number
  sessions_completed: number
  top_agents: Array<{
    agent: string
    orders: number
    revenue: number
  }>
}

const periods = ["7d", "30d", "90d"] as const

const DashboardAgentStats = () => {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [period, setPeriod] = useState<string>("30d")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/admin/agentic-commerce/analytics?period=${period}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setData(json))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [period])

  if (loading && !data) return null

  // Empty state
  if (!data || data.orders === 0) {
    return (
      <Container className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <Text size="large" weight="plus">
            Agent Commerce
          </Text>
        </div>
        <Text className="text-ui-fg-subtle">
          No agent orders yet. Configure agentic commerce in{" "}
          <a href="/app/settings/agentic-commerce" className="text-ui-fg-interactive underline">
            Settings
          </a>{" "}
          to get started.
        </Text>
      </Container>
    )
  }

  const currencyLabel = data.currency?.toUpperCase() || "EUR"

  return (
    <Container className="mb-4">
      <div className="flex items-center justify-between mb-4">
        <Text size="large" weight="plus">
          Agent Commerce
        </Text>
        <div className="flex gap-1">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-1 text-xs rounded ${
                period === p
                  ? "bg-ui-bg-base-pressed text-ui-fg-base"
                  : "text-ui-fg-subtle hover:text-ui-fg-base"
              }`}
            >
              {p === "7d" ? "7 days" : p === "30d" ? "30 days" : "90 days"}
            </button>
          ))}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <Text size="xlarge" weight="plus">
            {data.orders}
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Orders
          </Text>
        </div>
        <div className="text-center">
          <Text size="xlarge" weight="plus">
            {data.revenue.toFixed(0)} {currencyLabel}
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Revenue
          </Text>
        </div>
        <div className="text-center">
          <Text size="xlarge" weight="plus">
            {data.conversion_rate}%
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Conversion
          </Text>
        </div>
        <div className="text-center">
          <Text size="xlarge" weight="plus">
            {data.sessions_created}
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Sessions
          </Text>
        </div>
      </div>

      {/* Top agents */}
      {data.top_agents.length > 0 && (
        <div>
          <Text size="small" weight="plus" className="text-ui-fg-subtle mb-2 block">
            Top Agents
          </Text>
          <div className="space-y-1">
            {data.top_agents.map((agent) => (
              <div key={agent.agent} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Badge size="2xsmall" color="grey">
                    {agent.agent}
                  </Badge>
                </div>
                <Text className="text-ui-fg-subtle">
                  {agent.orders} order{agent.orders !== 1 ? "s" : ""} ({agent.revenue.toFixed(0)} {currencyLabel})
                </Text>
              </div>
            ))}
          </div>
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.list.before",
})

export default DashboardAgentStats
