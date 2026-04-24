import "dotenv/config"

// Dynamic import to handle CJS/ESM boundary with the prism-payment package
const mod = await import("../../packages/prism-payment/src/lib/prism-client")
const { PrismClient } = mod

const client = new PrismClient({
  apiUrl: process.env.PRISM_API_URL,
  apiKey: process.env.PRISM_API_KEY,
})

export { client }
