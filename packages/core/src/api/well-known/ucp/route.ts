import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sendUcpProfile } from "../../../lib/ucp-discovery"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  await sendUcpProfile(req, res)
}
