import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeActivity, normalizeSpin } from "./ledger"
import { buildSeries, summarize } from "./series"
import { dayKey, weekKey } from "./time"
import type { LedgerTransaction } from "./types"

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

describe("gacha normalization", () => {
  const spins = [
    normalizeSpin({
      id: 1,
      spin_txn_created_at: "2026-11-13T14:00:00.000Z",
      spin_cost: 100,
      spin_status: "confirmed",
      spin_refunded: false,
      spin_free_spin: false,
      buyback_webhook_confirmed: true,
      buyback_refund_amount: "46500000",
      memo: "slabz-32f1a148-ac2b-4af2-b311-9d708d3cb40c",
      hashlist_metadata: {
        content: {
          metadata: {
            name: "Card A",
            attributes: [{ trait_type: "Category", value: "Pokemon" }],
          },
        },
      },
    }),
    normalizeSpin({
      id: 2,
      spin_cost: 50,
      spin_status: "confirmed",
      spin_refunded: true,
      spin_txn_created_at: "2026-11-13T14:00:00.000Z",
      buyback_refund_amount: "999000000",
      buyback_webhook_confirmed: true,
    }),
    normalizeSpin({
      id: 3,
      spin_cost: 25,
      spin_free_spin: true,
      spin_status: "confirmed",
      spin_refunded: null,
      spin_txn_created_at: "2026-11-12T10:00:00.000Z",
      buyback_webhook_confirmed: true,
      buyback_refund_amount: "34000000",
    }),
    normalizeSpin({
      id: 4,
      spin_cost: 25,
      spin_status: "confirmed",
      spin_refunded: null,
      spin_txn_created_at: "2026-11-13T17:30:00.000Z",
      buyback_webhook_confirmed: null,
      buyback_refund_amount: null,
      buyback_transaction_signature: null,
    }),
    normalizeSpin({
      id: 5,
      spin_cost: 50,
      spin_status: "confirmed",
      spin_refunded: null,
      spin_txn_created_at: "2026-11-10T00:00:00.000Z",
      buyback_webhook_confirmed: false,
      buyback_refund_amount: "10000000",
      buyback_transaction_signature: "sig",
    }),
  ].filter((row): row is LedgerTransaction => row != null)

  it("converts buybacks from micro-USDC and drops refunds", () => {
    const first = spins[0]
    assert.equal(first.spentMicros, 100_000_000)
    assert.equal(first.returnedMicros, 46_500_000)
    assert.equal(first.pnlMicros, -53_500_000)
    assert.equal(first.source, "slabz")
    assert.equal(first.title, "Card A")
    assert.equal(spins[1].counted, false)
    assert.equal(spins[1].pnlMicros, null)
    assert.equal(spins[2].spentMicros, 0)
    assert.equal(spins[2].returnedMicros, 34_000_000)
    assert.ok(spins[2].flags.includes("free"))
    assert.equal(spins[3].returnedMicros, 0)
    assert.ok(spins[3].flags.includes("kept"))
    assert.equal(spins[4].returnedMicros, null)
    assert.equal(spins[4].unconfirmedReturnMicros, 10_000_000)
    assert.equal(spins[4].pnlMicros, null)
  })

  it("scores win and loss days in Asia/Jakarta", () => {
    const summary = summarize(spins, "Asia/Jakarta")
    assert.equal(summary.refunded, 1)
    assert.equal(summary.packs, 4)
    assert.equal(summary.spentMicros, 175_000_000)
    assert.equal(summary.returnedMicros, 80_500_000)
    assert.equal(summary.netMicros, -94_500_000)
    assert.equal(summary.returnedPartial, true)
    assert.equal(summary.winDays, 1)
    assert.equal(summary.lossDays, 2)
    assert.equal(summary.unscoredDays, 1)
    assert.equal(summary.best?.key, "2026-11-12")
    assert.equal(summary.worst?.key, "2026-11-13")
    assert.equal(dayKey(new Date("2026-11-13T17:30:00.000Z"), "Asia/Jakarta"), "2026-11-14")
    assert.equal(dayKey(new Date("2026-11-13T16:59:59.000Z"), "Asia/Jakarta"), "2026-11-13")
  })
})

describe("marketplace activity", () => {
  it("counts a buy and a sale in USDC and ignores listings", () => {
    const wallet = "ME"
    const buy = normalizeActivity(
      {
        action: "Sale",
        amount: 165,
        priceInfo: {
          splPrice: { rawAmount: "165000000", decimals: 6, symbol: "USDC", address: USDC },
        },
        createdAt: "2026-10-03T14:31:37.000Z",
        card: { itemName: "Charizard", category: "Pokemon" },
        nftAddress: "nft1",
        from: { wallet: "SELLER" },
        to: { wallet },
        transactionUrl: "https://solscan.io/tx/abc",
      },
      wallet,
    )
    const sale = normalizeActivity(
      {
        action: "Sale",
        priceInfo: { splPrice: { rawAmount: "150000000", decimals: 6, symbol: "USDC" } },
        createdAt: "2026-10-03T14:02:00.000Z",
        card: { itemName: "Charizard" },
        from: { wallet },
        to: { wallet: "BUYER" },
        transactionUrl: "sigsale",
      },
      wallet,
    )
    const listing = normalizeActivity(
      {
        action: "List",
        amount: 10,
        createdAt: "2026-10-01T00:00:00.000Z",
        from: { wallet },
      },
      wallet,
    )
    assert.equal(buy.transaction?.kind, "buy")
    assert.equal(buy.transaction?.spentMicros, 165_000_000)
    assert.equal(buy.transaction?.pnlMicros, -165_000_000)
    assert.equal(sale.transaction?.kind, "sale")
    assert.equal(sale.transaction?.returnedMicros, 150_000_000)
    assert.equal(sale.transaction?.pnlMicros, 150_000_000)
    assert.equal(listing.transaction, null)
    assert.equal(listing.ignored, true)

    const summary = summarize(
      [buy.transaction, sale.transaction].filter((row): row is LedgerTransaction => row != null),
      "Asia/Jakarta",
    )
    assert.equal(summary.buySpentMicros, 165_000_000)
    assert.equal(summary.saleReturnedMicros, 150_000_000)
    assert.equal(summary.netMicros, -15_000_000)
  })

  it("leaves non-USDC prices unavailable", () => {
    const result = normalizeActivity(
      {
        action: "Sale",
        amount: 2,
        currency: "SOL",
        createdAt: "2026-10-03T14:31:37.000Z",
        from: { wallet: "SELLER" },
        to: { wallet: "ME" },
      },
      "ME",
    )
    assert.equal(result.transaction?.spentMicros, null)
    assert.equal(result.transaction?.pnlMicros, null)
  })
})

describe("series bucketing", () => {
  const now = new Date("2026-11-13T15:00:00.000Z")
  const zone = "Asia/Jakarta"
  const transactions: LedgerTransaction[] = []
  for (let age = 0; age < 40; age += 1) {
    const at = new Date(now.getTime() - age * 24 * 60 * 60 * 1000).toISOString()
    const positive = age % 2 === 0
    transactions.push({
      id: `spin:${age}`,
      at,
      kind: "pack",
      title: "Card",
      detail: null,
      spentMicros: 1_000_000,
      returnedMicros: positive ? 2_000_000 : 0,
      pnlMicros: positive ? 1_000_000 : -1_000_000,
      unconfirmedReturnMicros: null,
      signature: null,
      buybackSignature: null,
      source: "cc",
      flags: [],
      counted: true,
    })
  }

  it("changes the number of bars across ranges and buckets", () => {
    const daily7 = buildSeries(transactions, { timeZone: zone, bucket: "day", range: "7D", now })
    const daily30 = buildSeries(transactions, { timeZone: zone, bucket: "day", range: "30D", now })
    const weekly30 = buildSeries(transactions, { timeZone: zone, bucket: "week", range: "30D", now })
    const monthlyAll = buildSeries(transactions, { timeZone: zone, bucket: "month", range: "ALL", now })
    assert.ok(daily7.points.length < daily30.points.length)
    assert.ok(weekly30.points.length < daily30.points.length)
    assert.ok(monthlyAll.points.length < daily30.points.length)
    assert.ok(daily7.points.some((point) => point.pnlMicros > 0))
    assert.ok(daily7.points.some((point) => point.pnlMicros < 0))
    const summed = daily30.points.reduce((total, point) => total + point.pnlMicros, 0)
    assert.equal(daily30.points.at(-1)?.cumulativeMicros, summed)
    assert.equal(daily30.rangeNetMicros, summed)
  })

  it("skips buckets with no transactions", () => {
    const quiet: LedgerTransaction[] = [0, 12].map((age) => ({
      id: `gap:${age}`,
      at: new Date(now.getTime() - age * 24 * 60 * 60 * 1000).toISOString(),
      kind: "pack" as const,
      title: "Card",
      detail: null,
      spentMicros: 1_000_000,
      returnedMicros: 0,
      pnlMicros: -1_000_000,
      unconfirmedReturnMicros: null,
      signature: null,
      buybackSignature: null,
      source: "cc",
      flags: [],
      counted: true,
    }))
    const series = buildSeries(quiet, { timeZone: zone, bucket: "day", range: "ALL", now })
    assert.equal(series.points.length, 2)
    assert.equal(series.points[0]?.key < series.points[1]?.key, true)
    assert.equal(series.points[1]?.cumulativeMicros, -2_000_000)
  })

  it("starts weeks on Monday", () => {
    const key = weekKey(new Date("2026-11-14T00:30:00.000Z"), zone)
    const [year, month, day] = key.split("-").map(Number)
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)))
    assert.equal(weekday, "Mon")
  })
})
