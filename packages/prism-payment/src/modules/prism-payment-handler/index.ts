import { Module } from "@medusajs/framework/utils"
import PrismPaymentHandlerAdapter from "./service"

export const PRISM_PAYMENT_HANDLER_MODULE = "prismPaymentHandler"

export default Module(PRISM_PAYMENT_HANDLER_MODULE, {
  service: PrismPaymentHandlerAdapter,
})
