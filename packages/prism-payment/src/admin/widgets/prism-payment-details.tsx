import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Badge, Text, Copy, IconButton, Tooltip } from "@medusajs/ui"
import { ArrowUpRightOnBox, CheckCircleSolid, XCircleSolid } from "@medusajs/icons"
import { getExplorer, networkLabel, truncateHash } from "../lib/explorers"

/**
 * Prism settlement details for an order.
 *
 * Reads on-chain metadata that the Prism payment provider writes to
 * payment.data during authorizePayment / capturePayment (tx hash, network,
 * settled_at, payer). Rendered in the sidebar below the Activity card on the
 * order detail page.
 */

type AdminPayment = {
  id: string
  provider_id?: string
  data?: Record<string, unknown> | null
}

type AdminPaymentCollection = {
  payments?: AdminPayment[]
}

type AdminOrder = {
  id: string
  payment_collections?: AdminPaymentCollection[]
}

type DetailWidgetProps = {
  data: AdminOrder
}

type PrismPaymentData = {
  transaction_reference?: string
  transaction_network?: string
  transaction_status?: string
  prism_tx_id?: string
  network?: string
  settled_at?: string
  payer?: string
  error?: string
  errorReason?: string
}

const PRISM_PROVIDER_PREFIX = "pp_prism"

const PrismPaymentDetails = ({ data: order }: DetailWidgetProps) => {
  const prismPayments =
    order.payment_collections?.flatMap((pc) =>
      (pc.payments ?? []).filter((p) =>
        p.provider_id?.startsWith(PRISM_PROVIDER_PREFIX)
      )
    ) ?? []

  if (prismPayments.length === 0) return <></>

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Prism Settlement</Heading>
      </div>
      {prismPayments.map((payment) => (
        <PrismPaymentRow
          key={payment.id}
          data={(payment.data ?? {}) as PrismPaymentData}
        />
      ))}
    </Container>
  )
}

const PrismPaymentRow = ({ data }: { data: PrismPaymentData }) => {
  const txHash = data.transaction_reference || data.prism_tx_id
  const network = data.transaction_network || data.network
  const settledAt = data.settled_at
  const payer = data.payer
  const errorMsg = data.errorReason || data.error
  const hasError = Boolean(errorMsg)
  const explorer = getExplorer(network)

  return (
    <div className="flex flex-col gap-y-3 px-6 py-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-x-2">
          {hasError ? (
            <XCircleSolid className="text-ui-fg-error" />
          ) : (
            <CheckCircleSolid className="text-ui-tag-green-icon" />
          )}
          <Badge size="2xsmall" color={hasError ? "red" : "green"}>
            {networkLabel(network)}
          </Badge>
        </div>
        {settledAt && (
          <Text size="small" className="text-ui-fg-subtle">
            {new Date(settledAt).toLocaleString()}
          </Text>
        )}
      </div>

      {hasError && (
        <Text size="small" className="text-ui-fg-error">
          {errorMsg}
        </Text>
      )}

      {txHash && (
        <Row label="Tx">
          <Text size="small" className="font-mono truncate" title={txHash}>
            {truncateHash(txHash)}
          </Text>
          <Copy content={txHash} />
          {explorer && (
            <Tooltip content={`View on ${explorer.name}`}>
              <IconButton size="2xsmall" variant="transparent" asChild>
                <a href={explorer.txUrl(txHash)} target="_blank" rel="noreferrer">
                  <ArrowUpRightOnBox />
                </a>
              </IconButton>
            </Tooltip>
          )}
        </Row>
      )}

      {payer && (
        <Row label="Payer">
          <Text size="small" className="font-mono truncate" title={payer}>
            {truncateHash(payer)}
          </Text>
          <Copy content={payer} />
          {explorer && (
            <Tooltip content={`View on ${explorer.name}`}>
              <IconButton size="2xsmall" variant="transparent" asChild>
                <a
                  href={explorer.addressUrl(payer)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ArrowUpRightOnBox />
                </a>
              </IconButton>
            </Tooltip>
          )}
        </Row>
      )}
    </div>
  )
}

const Row = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <div className="grid grid-cols-[60px_1fr] items-center gap-x-2">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <div className="flex items-center gap-x-1 min-w-0">{children}</div>
  </div>
)

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default PrismPaymentDetails
