export type TxKind = "pack" | "buy" | "sale"

export type LedgerTransaction = {
  id: string
  at: string | null
  kind: TxKind
  title: string
  detail: string | null
  spentMicros: number | null
  returnedMicros: number | null
  pnlMicros: number | null
  /** Present when a buyback amount exists but is not webhook-confirmed. Not included in totals. */
  unconfirmedReturnMicros: number | null
  signature: string | null
  buybackSignature: string | null
  source: string | null
  flags: string[]
  counted: boolean
}

export type MarketplaceStatus = {
  status: "ok" | "unavailable"
  error?: string
  ignored: number
}

export type WalletReport = {
  wallet: string
  fetchedAt: string
  transactions: LedgerTransaction[]
  marketplace: MarketplaceStatus
  truncated: boolean
}
