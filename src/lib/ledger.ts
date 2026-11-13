import type { LedgerTransaction, TxKind } from "./types"

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const SETTLED_ACTIONS = new Set([
  "sale",
  "sell",
  "buy",
  "acceptoffer",
  "offeraccepted",
])
const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true" || value === 1
}

function parseMicros(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return null
}

function dollarsToMicros(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 1_000_000)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed * 1_000_000)
  }
  return null
}

function validAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  return new Date(time).toISOString()
}

export function sourceFromMemo(memo: string | null): string | null {
  if (!memo) return null
  const prefixed = memo.match(new RegExp(`^(.+)-${UUID.source}$`, "i"))
  if (prefixed) return prefixed[1].toLowerCase()
  if (UUID.test(memo)) return ""
  return memo
}

function attribute(
  metadata: Record<string, unknown> | null,
  trait: string,
): string | null {
  const attributes = metadata?.attributes
  if (!Array.isArray(attributes)) return null
  for (const entry of attributes) {
    const record = asRecord(entry)
    if (!record) continue
    if (record.trait_type === trait && typeof record.value === "string" && record.value) {
      return record.value
    }
  }
  return null
}

function cardLabel(metadata: unknown): { title: string; detail: string | null } {
  const root = asRecord(metadata)
  const content = asRecord(root?.content)
  const meta = asRecord(content?.metadata)
  const name = typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : null
  const category = attribute(meta, "Category")
  const grade = attribute(meta, "The Grade")
  const detail = [category, grade].filter(Boolean).join(" · ")
  return {
    title: name ?? "Card name unavailable",
    detail: detail || null,
  }
}

export function normalizeSpin(raw: unknown): LedgerTransaction | null {
  const row = asRecord(raw)
  if (!row) return null
  if (typeof row.id !== "number" && typeof row.id !== "string") return null

  const refunded = isTrue(row.spin_refunded)
  const free = isTrue(row.spin_free_spin)
  const status = typeof row.spin_status === "string" ? row.spin_status : null
  const confirmedBuyback = isTrue(row.buyback_webhook_confirmed)
  const buybackSignature =
    typeof row.buyback_transaction_signature === "string" &&
    row.buyback_transaction_signature
      ? row.buyback_transaction_signature
      : null
  const amountMicros = parseMicros(row.buyback_refund_amount)
  const { title, detail } = cardLabel(row.hashlist_metadata)
  const flags: string[] = []
  if (free) flags.push("free")
  if (refunded) flags.push("refunded")

  const spentMicros = free ? 0 : dollarsToMicros(row.spin_cost)
  let returnedMicros: number | null
  let unconfirmedReturnMicros: number | null = null
  if (confirmedBuyback) {
    returnedMicros = amountMicros
  } else if (amountMicros == null && !buybackSignature) {
    returnedMicros = 0
    if (!refunded) flags.push("kept")
  } else {
    returnedMicros = null
    unconfirmedReturnMicros = amountMicros
    flags.push("unconfirmed")
  }

  const counted = !refunded && (status == null || status === "confirmed")
  if (status && status !== "confirmed") flags.push(status)
  const pnlMicros =
    counted && spentMicros != null && returnedMicros != null
      ? returnedMicros - spentMicros
      : null

  return {
    id: `spin:${row.id}`,
    at: validAt(row.spin_txn_created_at),
    kind: "pack",
    title,
    detail,
    spentMicros,
    returnedMicros,
    pnlMicros,
    unconfirmedReturnMicros,
    signature:
      typeof row.spin_txn_signature === "string" ? row.spin_txn_signature : null,
    buybackSignature,
    source: sourceFromMemo(typeof row.memo === "string" ? row.memo : null),
    flags,
    counted,
  }
}

function partyWallet(value: unknown): string | null {
  const party = asRecord(value)
  if (!party || typeof party.wallet !== "string" || !party.wallet) return null
  return party.wallet
}

function usdcMicros(row: Record<string, unknown>): number | null {
  const priceInfo = asRecord(row.priceInfo)
  const spl = asRecord(priceInfo?.splPrice)
  if (spl) {
    const symbol = typeof spl.symbol === "string" ? spl.symbol : null
    const address = typeof spl.address === "string" ? spl.address : null
    const decimals = typeof spl.decimals === "number" ? spl.decimals : 6
    const raw = spl.rawAmount
    const isUsdc = symbol === "USDC" || address === USDC_MINT
    if ((symbol && symbol !== "USDC") || (address && address !== USDC_MINT && symbol !== "USDC")) {
      return null
    }
    if (isUsdc && (typeof raw === "string" || typeof raw === "number") && String(raw).trim()) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return Math.round(parsed * 10 ** (6 - decimals))
    }
  }
  const currency = typeof row.currency === "string" ? row.currency : null
  if (currency && currency !== "USDC") return null
  if (typeof row.amount === "number" && Number.isFinite(row.amount)) {
    return Math.round(row.amount * 1_000_000)
  }
  return null
}

export function normalizeActivity(
  raw: unknown,
  wallet: string,
): { transaction: LedgerTransaction | null; ignored: boolean } {
  const row = asRecord(raw)
  if (!row) return { transaction: null, ignored: false }
  const action = typeof row.action === "string" ? row.action : ""
  const key = action.toLowerCase().replace(/[\s_-]/g, "")
  if (!action) return { transaction: null, ignored: false }
  if (!SETTLED_ACTIONS.has(key)) return { transaction: null, ignored: true }

  const from = partyWallet(row.from)
  const to = partyWallet(row.to)
  let kind: TxKind | null = null
  if (to === wallet && from !== wallet) kind = "buy"
  else if (from === wallet && to !== wallet) kind = "sale"
  else if (to === wallet) kind = "buy"
  else if (from === wallet) kind = "sale"

  const card = asRecord(row.card)
  const title =
    typeof card?.itemName === "string" && card.itemName.trim()
      ? card.itemName.trim()
      : "Card name unavailable"
  const category = typeof card?.category === "string" && card.category ? card.category : null
  const nft = typeof row.nftAddress === "string" ? row.nftAddress : "nonft"
  const at = validAt(row.createdAt)
  const signature =
    typeof row.transactionUrl === "string" && row.transactionUrl
      ? row.transactionUrl
      : null
  const micros = usdcMicros(row)
  const flags: string[] = []
  if (!kind) flags.push("direction-unknown")

  const spentMicros = kind === "sale" ? 0 : kind === "buy" ? micros : null
  const returnedMicros = kind === "buy" ? 0 : kind === "sale" ? micros : null
  const counted = true
  const pnlMicros =
    spentMicros != null && returnedMicros != null ? returnedMicros - spentMicros : null

  return {
    ignored: false,
    transaction: {
      id: `mkt:${key}:${at ?? "nodate"}:${nft}:${from ?? ""}:${to ?? ""}`,
      at,
      kind: kind ?? "sale",
      title,
      detail: category,
      spentMicros,
      returnedMicros,
      pnlMicros,
      unconfirmedReturnMicros: null,
      signature,
      buybackSignature: null,
      source: "marketplace",
      flags,
      counted,
    },
  }
}

export function dedupeIds(transactions: LedgerTransaction[]): LedgerTransaction[] {
  const seen = new Map<string, number>()
  return transactions.map((transaction) => {
    const count = seen.get(transaction.id) ?? 0
    seen.set(transaction.id, count + 1)
    if (count === 0) return transaction
    return { ...transaction, id: `${transaction.id}:${count}` }
  })
}
