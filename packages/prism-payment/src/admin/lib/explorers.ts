/**
 * Maps x402 network identifiers (as stored in payment.data.network) to block
 * explorer URLs. Our provider stores the lowercased x402 network string from
 * the payment authorization (e.g. "base", "base-sepolia").
 */

type ExplorerConfig = {
  name: string
  txUrl: (hash: string) => string
  addressUrl: (address: string) => string
}

const EXPLORERS: Record<string, ExplorerConfig> = {
  "ethereum": {
    name: "Etherscan",
    txUrl: (h) => `https://etherscan.io/tx/${h}`,
    addressUrl: (a) => `https://etherscan.io/address/${a}`,
  },
  "base": {
    name: "Basescan",
    txUrl: (h) => `https://basescan.org/tx/${h}`,
    addressUrl: (a) => `https://basescan.org/address/${a}`,
  },
  "base-sepolia": {
    name: "Base Sepolia",
    txUrl: (h) => `https://sepolia.basescan.org/tx/${h}`,
    addressUrl: (a) => `https://sepolia.basescan.org/address/${a}`,
  },
  "polygon": {
    name: "Polygonscan",
    txUrl: (h) => `https://polygonscan.com/tx/${h}`,
    addressUrl: (a) => `https://polygonscan.com/address/${a}`,
  },
  "arbitrum": {
    name: "Arbiscan",
    txUrl: (h) => `https://arbiscan.io/tx/${h}`,
    addressUrl: (a) => `https://arbiscan.io/address/${a}`,
  },
}

export function getExplorer(network: string | undefined): ExplorerConfig | null {
  if (!network) return null
  return EXPLORERS[network.toLowerCase()] ?? null
}

export function networkLabel(network: string | undefined): string {
  if (!network) return "Unknown network"
  return EXPLORERS[network.toLowerCase()]?.name ?? network
}

export function truncateHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= head + tail + 3) return hash
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`
}
