import { Module } from "@medusajs/framework/utils"
import AgentSessionService from "./service"
import { AGENT_SESSION_MODULE } from "../../lib/agent-session"

export { AGENT_SESSION_MODULE }

export default Module(AGENT_SESSION_MODULE, {
  service: AgentSessionService,
})
