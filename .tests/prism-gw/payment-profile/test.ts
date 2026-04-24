/**
 * Integration test: PrismClient.fetchPaymentProfile()
 *
 * Calls the real PrismClient against the gateway and prints the result.
 *
 * Run: npm run test:payment-profile (from .tests/prism-gw/)
 */
import { client } from "../config"

console.log("=== PrismClient.fetchPaymentProfile() ===\n")

try {
  const result = await client.fetchPaymentProfile()
  console.log("Result:", JSON.stringify(result, null, 2))
} catch (error) {
  console.error("Error:", error instanceof Error ? error.message : error)
  process.exit(1)
}
