import { describe, it, expect, vi } from "vitest"
import { MedusaError } from "@medusajs/framework/utils"
import PrismPaymentProviderService from "../modules/prism-payment/service"

function makeProvider() {
  const provider = new PrismPaymentProviderService({}, {
    api_url: "https://gw.test",
    api_key: "key",
  } as any)
  const client = { fetchSettlementSummary: vi.fn() }
  ;(provider as any).client = client
  return { provider, client }
}

const confirmed = {
  transaction: "0xabc",
  network: "eip155:84532",
  asset: "USDC",
  status: "confirmed",
  gross: "100.00",
  fee: "1.50",
  cashback: "5.00",
  net: "93.50",
}

describe("refundPayment", () => {
  it("rejects with the net amount to refund manually", async () => {
    const { provider, client } = makeProvider()
    client.fetchSettlementSummary.mockResolvedValue(confirmed)

    await expect(
      provider.refundPayment({ amount: 100, data: { prism_tx_id: "0xabc" } } as any),
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: expect.stringContaining("up to 93.50 USDC"),
    })
    expect(client.fetchSettlementSummary).toHaveBeenCalledWith("0xabc")
  })

  it("reports cashback and fees in the message", async () => {
    const { provider, client } = makeProvider()
    client.fetchSettlementSummary.mockResolvedValue(confirmed)

    await expect(
      provider.refundPayment({ amount: 100, data: { transaction_reference: "0xabc" } } as any),
    ).rejects.toMatchObject({
      message: expect.stringContaining("5.00 USDC cashback already paid to the buyer, 1.50 USDC fees"),
    })
  })

  it("says the summary is unavailable when Prism cannot be reached", async () => {
    const { provider, client } = makeProvider()
    client.fetchSettlementSummary.mockRejectedValue(new Error("timeout"))

    await expect(
      provider.refundPayment({ amount: 100, data: { prism_tx_id: "0xabc" } } as any),
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: expect.stringContaining("unavailable"),
    })
  })

  it("says the summary is unavailable when the payment is only broadcasted", async () => {
    const { provider, client } = makeProvider()
    client.fetchSettlementSummary.mockResolvedValue({ ...confirmed, status: "broadcasted" })

    await expect(
      provider.refundPayment({ amount: 100, data: { prism_tx_id: "0xabc" } } as any),
    ).rejects.toMatchObject({ message: expect.stringContaining("unavailable") })
  })

  it("says the summary is unavailable when a confirmed summary has no net amount", async () => {
    const { provider, client } = makeProvider()
    const { net: _net, ...withoutNet } = confirmed
    client.fetchSettlementSummary.mockResolvedValue(withoutNet)

    await expect(
      provider.refundPayment({ amount: 100, data: { prism_tx_id: "0xabc" } } as any),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining("undefined"),
    })
    await expect(
      provider.refundPayment({ amount: 100, data: { prism_tx_id: "0xabc" } } as any),
    ).rejects.toMatchObject({ message: expect.stringContaining("unavailable") })
  })

  it("does not call Prism when the payment has no transaction hash", async () => {
    const { provider, client } = makeProvider()

    await expect(
      provider.refundPayment({ amount: 100, data: {} } as any),
    ).rejects.toMatchObject({ message: expect.stringContaining("unavailable") })
    expect(client.fetchSettlementSummary).not.toHaveBeenCalled()
  })
})
