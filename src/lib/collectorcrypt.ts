import { dedupeIds, normalizeActivity, normalizeSpin } from "./ledger"
import type { LedgerTransaction, WalletReport } from "./types"

const GACHA_URL = "https://gacha.collectorcrypt.com/api/userStats"
const ACTIVITY_URL = "https://api.collectorcrypt.com/card-activity"
const PAGE_SIZE = 1000
const MAX_PAGES = 40

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function isSolanaAddress(value: string): boolean {
  return SOLANA_ADDRESS.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("Collector Crypt returned a response that was not JSON.")
  }
}

export async function fetchSpins(wallet: string): Promise<{
  spins: unknown[]
  truncated: boolean
  pages: number
}> {
  const spins: unknown[] = []
  const seen = new Set<string>()
  let lastId: string | null = null
  let truncated = false
  let pages = 0

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(GACHA_URL)
    url.searchParams.set("wallet", wallet)
    url.searchParams.set("count", String(PAGE_SIZE))
    if (lastId != null) url.searchParams.set("last_id", lastId)

    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) {
      throw new Error(`Collector Crypt gacha history failed (${response.status}).`)
    }
    const body = asRecord(await readJson(response))
    if (!body || body.success !== true) {
      throw new Error("Collector Crypt gacha history did not return a success payload.")
    }
    const data = asRecord(body.data)
    const linked = data?.linkedAll
    if (!Array.isArray(linked)) {
      throw new Error("Collector Crypt gacha history was missing the spin list.")
    }

    let added = 0
    for (const spin of linked) {
      const record = asRecord(spin)
      const id = record?.id
      const key = id == null ? null : String(id)
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      spins.push(spin)
      added += 1
    }
    pages += 1

    const pagination = asRecord(data?.pagination)
    const hasMore = pagination?.hasMore === true
    const nextLast = pagination?.lastId
    if (!hasMore) {
      return { spins, truncated: false, pages }
    }
    if (added === 0 || nextLast == null || String(nextLast) === lastId) {
      truncated = true
      break
    }
    lastId = String(nextLast)
  }

  if (pages >= MAX_PAGES) truncated = true
  return { spins, truncated, pages }
}

export async function fetchMarketplace(wallet: string): Promise<{
  events: unknown[]
  status: "ok" | "unavailable"
  error?: string
}> {
  const url = new URL(ACTIVITY_URL)
  url.searchParams.set("wallet", wallet)
  url.searchParams.set("v2", "true")
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      return {
        events: [],
        status: "unavailable",
        error: `Marketplace activity failed (${response.status}).`,
      }
    }
    const body = await readJson(response)
    if (Array.isArray(body)) return { events: body, status: "ok" }
    const record = asRecord(body)
    if (record && Array.isArray(record.data)) return { events: record.data, status: "ok" }
    return {
      events: [],
      status: "unavailable",
      error: "Marketplace activity response was not a list.",
    }
  } catch (error) {
    return {
      events: [],
      status: "unavailable",
      error: error instanceof Error ? error.message : "Marketplace activity unavailable.",
    }
  }
}

export async function loadWallet(wallet: string): Promise<WalletReport> {
  const [spinsResult, marketResult] = await Promise.all([
    fetchSpins(wallet),
    fetchMarketplace(wallet),
  ])

  const transactions: LedgerTransaction[] = []
  for (const spin of spinsResult.spins) {
    const transaction = normalizeSpin(spin)
    if (transaction) transactions.push(transaction)
  }

  let ignored = 0
  if (marketResult.status === "ok") {
    for (const event of marketResult.events) {
      const normalized = normalizeActivity(event, wallet)
      if (normalized.ignored) ignored += 1
      if (normalized.transaction) transactions.push(normalized.transaction)
    }
  }

  return {
    wallet,
    fetchedAt: new Date().toISOString(),
    transactions: dedupeIds(transactions),
    marketplace: {
      status: marketResult.status,
      error: marketResult.error,
      ignored,
    },
    truncated: spinsResult.truncated,
  }
}
