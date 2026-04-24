/**
 * Integration test: PrismClient.checkoutPrepare()
 *
 * Reads request.json, calls the real PrismClient against the gateway,
 * and prints the result or error.
 *
 * Run: npm run test:checkout-prepare (from .tests/prism-gw/)
 */
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { client } from "../config"

const __dirname = dirname(fileURLToPath(import.meta.url))
const request = JSON.parse(readFileSync(resolve(__dirname, "request.json"), "utf-8"))

console.log("=== PrismClient.checkoutPrepare() ===")
console.log("Input:", JSON.stringify(request, null, 2), "\n")

try {
  const result = await client.checkoutPrepare({
    amount: request.amount,
    currency: request.currency,
    resourceUrl: request.resource.url,
    resourceDescription: request.resource.description,
  })

  console.log("Result:", JSON.stringify(result, null, 2))
  console.log(`\naccepts count: ${result.config.accepts.length}`)
} catch (error) {
  console.error("Error:", error instanceof Error ? error.message : error)
  process.exit(1)
}
