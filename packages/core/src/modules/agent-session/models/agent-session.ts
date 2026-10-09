import { model } from "@medusajs/framework/utils"

const AgentSession = model.define("agent_session", {
  id: model.id({ prefix: "agsess" }).primaryKey(),
  cart_id: model.text().unique(),
  session_fingerprint: model.text(),
  ucp_version: model.text().nullable(),
  canceled_at: model.dateTime().nullable(),
  handler_data: model.json().nullable(),
})

export default AgentSession
