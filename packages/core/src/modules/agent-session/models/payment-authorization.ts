import { model } from "@medusajs/framework/utils"

const PaymentAuthorization = model
  .define("payment_authorization", {
    id: model.id({ prefix: "payauth" }).primaryKey(),
    asset: model.text(),
    payer: model.text(),
    nonce: model.text(),
    cart_id: model.text(),
  })
  .indexes([{ on: ["asset", "payer", "nonce"], unique: true }])

export default PaymentAuthorization
