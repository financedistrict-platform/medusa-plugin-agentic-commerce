import type { PaymentLedgerStore } from "../../lib/payment-ledger"

export function fakePaymentLedger() {
  const holders = new Map<string, string>()
  const store: PaymentLedgerStore & { holders: Map<string, string> } = {
    holders,
    async reserve({ asset, payer, nonce, cartId }) {
      const key = [asset, payer, nonce].map((part) => part.toLowerCase()).join("|")
      const holder = holders.get(key)
      if (holder !== undefined) return holder === cartId
      holders.set(key, cartId)
      return true
    },
  }
  return store
}
