import { Module } from "@medusajs/framework/utils"
import AgenticCommerceService from "./service"

export const AGENTIC_COMMERCE_MODULE = "agenticCommerce"

export default Module(AGENTIC_COMMERCE_MODULE, {
  service: AgenticCommerceService,
})
