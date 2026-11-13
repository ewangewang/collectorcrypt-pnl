import type { LedgerTransaction } from "./types"
import { addDays, addMonths, dayKey, formatDayKey, monthKey, weekKey } from "./time"

export type Bucket = "day" | "week" | "month"
export type RangeKey = "7D" | "30D" | "90D" | "ALL"

export type SeriesPoint = {
  key: string
  label: string
  tooltip: string
  pnlMicros: number
  cumulativeMicros: number
  incomplete: boolean
}

export type Series = {
  points: SeriesPoint[]
  rangeNetMicros: number
  incompleteCount: number
}

export type DayScore = {
  key: string
  label: string
  pnlMicros: number
}

export type Summary = {
  spentMicros: number
  returnedMicros: number
  netMicros: number
  spentPartial: boolean
  returnedPartial: boolean
  packSpentMicros: number
  packReturnedMicros: number
  buySpentMicros: number
  saleReturnedMicros: number
  counted: number
  packs: number
  buys: number
  sales: number
  refunded: number
  kept: number
  unconfirmed: number
  freeSpins: number
  winDays: number
  lossDays: number
  flatDays: number
  unscoredDays: number
  best: DayScore | null
  worst: DayScore | null
}

const RANGE_DAYS: Record<Exclude<RangeKey, "ALL">, number> = {
  "7D": 7,
  "30D": 30,
  "90D": 90,
}

export function rangeStart(now: Date, range: RangeKey): Date | null {
  if (range === "ALL") return null
  return new Date(now.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000)
}

export function bucketKey(date: Date, bucket: Bucket, timeZone: string): string {
  if (bucket === "week") return weekKey(date, timeZone)
  if (bucket === "month") return monthKey(date, timeZone)
  return dayKey(date, timeZone)
}

function nextKey(key: string, bucket: Bucket): string {
  if (bucket === "month") return addMonths(key, 1)
  if (bucket === "week") return addDays(key, 7)
  return addDays(key, 1)
}

export function enumerateKeys(start: string, end: string, bucket: Bucket): string[] {
  if (start > end) return []
  const keys: string[] = []
  let cursor = start
  for (let guard = 0; cursor <= end && guard < 5000; guard += 1) {
    keys.push(cursor)
    const upcoming = nextKey(cursor, bucket)
    if (upcoming <= cursor) break
    cursor = upcoming
  }
  return keys
}

function bucketLabel(key: string, bucket: Bucket): { label: string; tooltip: string } {
  if (bucket === "month") {
    const [year, month] = key.split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1, 1))
    const shortMonth = new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: "UTC",
    }).format(date)
    const full = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date)
    return { label: `${shortMonth} '${String(year).slice(2)}`, tooltip: full }
  }
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const short = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date)
  if (bucket === "week") return { label: short, tooltip: `Week of ${short} ${year}` }
  return { label: short, tooltip: `${short} ${year}` }
}

function inWindow(transaction: LedgerTransaction, start: Date | null): boolean {
  if (!transaction.at) return false
  const time = Date.parse(transaction.at)
  if (Number.isNaN(time)) return false
  if (start && time < start.getTime()) return false
  return true
}

export function buildSeries(
  transactions: LedgerTransaction[],
  options: { timeZone: string; bucket: Bucket; range: RangeKey; now?: Date },
): Series {
  const now = options.now ?? new Date()
  const start = rangeStart(now, options.range)
  const dated = transactions.filter(
    (transaction) => transaction.counted && inWindow(transaction, start),
  )
  if (options.range === "ALL" && dated.length === 0) {
    return { points: [], rangeNetMicros: 0, incompleteCount: 0 }
  }

  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  for (const transaction of dated) {
    const time = Date.parse(transaction.at as string)
    if (Number.isNaN(time)) continue
    if (time < earliest) earliest = time
    if (time > latest) latest = time
  }
  const endInstant = new Date(Math.max(now.getTime(), Number.isFinite(latest) ? latest : 0))
  const startInstant =
    options.range === "ALL" && Number.isFinite(earliest)
      ? new Date(earliest)
      : (start as Date)
  let startKey = bucketKey(startInstant, options.bucket, options.timeZone)
  let endKey = bucketKey(endInstant, options.bucket, options.timeZone)
  if (startKey > endKey) {
    const swap = startKey
    startKey = endKey
    endKey = swap
  }

  const slots = new Map<string, { pnl: number; incomplete: boolean; activity: boolean }>()
  let incompleteCount = 0
  for (const transaction of dated) {
    const key = bucketKey(new Date(transaction.at as string), options.bucket, options.timeZone)
    if (key < startKey || key > endKey) continue
    const slot = slots.get(key) ?? { pnl: 0, incomplete: false, activity: false }
    slot.activity = true
    if (transaction.pnlMicros == null) {
      slot.incomplete = true
      incompleteCount += 1
    } else {
      slot.pnl += transaction.pnlMicros
    }
    slots.set(key, slot)
  }

  const keys = [...slots.keys()].filter((key) => slots.get(key)?.activity).sort()
  let cumulative = 0
  const points = keys.map((key) => {
    const slot = slots.get(key) ?? { pnl: 0, incomplete: false }
    cumulative += slot.pnl
    const labels = bucketLabel(key, options.bucket)
    return {
      key,
      label: labels.label,
      tooltip: labels.tooltip,
      pnlMicros: slot.pnl,
      cumulativeMicros: cumulative,
      incomplete: slot.incomplete,
    }
  })

  return {
    points,
    rangeNetMicros: cumulative,
    incompleteCount,
  }
}

export function summarize(
  transactions: LedgerTransaction[],
  timeZone: string,
): Summary {
  const summary: Summary = {
    spentMicros: 0,
    returnedMicros: 0,
    netMicros: 0,
    spentPartial: false,
    returnedPartial: false,
    packSpentMicros: 0,
    packReturnedMicros: 0,
    buySpentMicros: 0,
    saleReturnedMicros: 0,
    counted: 0,
    packs: 0,
    buys: 0,
    sales: 0,
    refunded: 0,
    kept: 0,
    unconfirmed: 0,
    freeSpins: 0,
    winDays: 0,
    lossDays: 0,
    flatDays: 0,
    unscoredDays: 0,
    best: null,
    worst: null,
  }

  const days = new Map<string, { pnl: number; incomplete: boolean; any: boolean }>()

  for (const transaction of transactions) {
    if (transaction.flags.includes("refunded")) summary.refunded += 1
    if (!transaction.counted) continue
    summary.counted += 1
    if (transaction.kind === "pack") summary.packs += 1
    if (transaction.kind === "buy") summary.buys += 1
    if (transaction.kind === "sale") summary.sales += 1
    if (transaction.flags.includes("kept")) summary.kept += 1
    if (transaction.flags.includes("unconfirmed")) summary.unconfirmed += 1
    if (transaction.flags.includes("free")) summary.freeSpins += 1

    if (transaction.spentMicros == null) summary.spentPartial = true
    else {
      summary.spentMicros += transaction.spentMicros
      if (transaction.kind === "pack") summary.packSpentMicros += transaction.spentMicros
      if (transaction.kind === "buy") summary.buySpentMicros += transaction.spentMicros
    }
    if (transaction.returnedMicros == null) summary.returnedPartial = true
    else {
      summary.returnedMicros += transaction.returnedMicros
      if (transaction.kind === "pack") summary.packReturnedMicros += transaction.returnedMicros
      if (transaction.kind === "sale") summary.saleReturnedMicros += transaction.returnedMicros
    }

    if (!transaction.at) continue
    const time = Date.parse(transaction.at)
    if (Number.isNaN(time)) continue
    const key = dayKey(new Date(time), timeZone)
    const day = days.get(key) ?? { pnl: 0, incomplete: false, any: false }
    day.any = true
    if (transaction.pnlMicros == null) day.incomplete = true
    else day.pnl += transaction.pnlMicros
    days.set(key, day)
  }

  summary.netMicros = summary.returnedMicros - summary.spentMicros

  for (const [key, day] of days) {
    if (!day.any) continue
    if (day.incomplete) {
      summary.unscoredDays += 1
      continue
    }
    if (day.pnl > 0) summary.winDays += 1
    else if (day.pnl < 0) summary.lossDays += 1
    else summary.flatDays += 1
    const score: DayScore = { key, label: formatDayKey(key), pnlMicros: day.pnl }
    if (!summary.best || score.pnlMicros > summary.best.pnlMicros || (score.pnlMicros === summary.best.pnlMicros && score.key > summary.best.key)) {
      summary.best = score
    }
    if (!summary.worst || score.pnlMicros < summary.worst.pnlMicros || (score.pnlMicros === summary.worst.pnlMicros && score.key > summary.worst.key)) {
      summary.worst = score
    }
  }

  return summary
}
