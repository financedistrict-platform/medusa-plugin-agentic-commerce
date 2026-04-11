import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PrismPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PrismPaymentProviderService],
})
