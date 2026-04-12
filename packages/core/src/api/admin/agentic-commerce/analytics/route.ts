import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/agentic-commerce/analytics?period=30d
 *
 * Returns aggregated agent commerce metrics: order count, revenue,
 * conversion rate, and top agents. Protected by Medusa admin auth.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const period = (req.query.period as string) || "30d"
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30
  const since = new Date()
  since.setDate(since.getDate() - days)

  const query = req.scope.resolve("query") as any

  try {
    // Fetch recent orders (capped at 5000 to prevent DoS)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "total",
        "currency_code",
        "created_at",
        "cart_id",
      ],
      filters: {
        created_at: { $gte: since.toISOString() },
      },
      pagination: { take: 5000 },
    })

    // For each order, fetch cart metadata to identify agent orders
    const agentOrders: Array<{
      order: any
      agent: string
      protocol: string
    }> = []
    let sessionsCreated = 0

    // Batch-fetch cart metadata
    const cartIds = orders
      .map((o: any) => o.cart_id)
      .filter(Boolean)

    const cartMap = new Map<string, any>()
    if (cartIds.length > 0) {
      // Fetch in batches of 50
      for (let i = 0; i < cartIds.length; i += 50) {
        const batch = cartIds.slice(i, i + 50)
        const { data: carts } = await query.graph({
          entity: "cart",
          fields: ["id", "metadata"],
          filters: { id: batch },
        })
        for (const cart of carts) {
          cartMap.set(cart.id, cart)
        }
      }
    }

    for (const order of orders) {
      const cart = cartMap.get(order.cart_id)
      const meta = cart?.metadata
      if (!meta?.protocol_type) continue

      sessionsCreated++
      if (order.status !== "canceled") {
        agentOrders.push({
          order,
          agent: meta.agent_identifier || "unknown",
          protocol: meta.protocol_type,
        })
      }
    }

    // Aggregate metrics
    const totalRevenue = agentOrders.reduce(
      (sum, { order }) => sum + (order.total || 0),
      0
    )

    // Top agents
    const agentMap = new Map<string, { orders: number; revenue: number }>()
    for (const { agent, order } of agentOrders) {
      const existing = agentMap.get(agent) || { orders: 0, revenue: 0 }
      existing.orders++
      existing.revenue += order.total || 0
      agentMap.set(agent, existing)
    }

    const topAgents = Array.from(agentMap.entries())
      .map(([agent, stats]) => ({
        agent,
        orders: stats.orders,
        revenue: stats.revenue / 100,
      }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 10)

    const conversionRate =
      sessionsCreated > 0 ? agentOrders.length / sessionsCreated : 0

    res.json({
      period,
      orders: agentOrders.length,
      revenue: totalRevenue / 100,
      currency: orders[0]?.currency_code || "eur",
      conversion_rate: Math.round(conversionRate * 100),
      sessions_created: sessionsCreated,
      sessions_completed: agentOrders.length,
      top_agents: topAgents,
    })
  } catch (error: any) {
    console.error("[agentic-commerce] Analytics error:", error.message)
    res.status(500).json({ message: "Failed to compute analytics" })
  }
}
