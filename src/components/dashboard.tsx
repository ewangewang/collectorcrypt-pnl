"use client"

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { PnlChart } from "@/components/pnl-chart"
import { isSolanaAddress } from "@/lib/collectorcrypt"
import { explorerUrl, formatUsd, shortWallet } from "@/lib/money"
import { buildSeries, summarize, type Bucket, type RangeKey } from "@/lib/series"
import { DEFAULT_TIME_ZONE, detectTimeZone, formatInstant } from "@/lib/time"
import type { LedgerTransaction, TxKind, WalletReport } from "@/lib/types"

const RANGES: RangeKey[] = ["7D", "30D", "90D", "ALL"]
const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
]
const PAGE_SIZE = 25

const SOURCE_LABELS: Record<string, string> = {
  cc: "Collector Crypt",
  slabz: "Slabz",
  me: "Magic Eden",
  pull: "PocketPull",
  marketplace: "Marketplace",
  "": "Unknown source",
}

function sourceLabel(source: string | null): string | null {
  if (source == null) return null
  return SOURCE_LABELS[source] ?? source
}

function tone(micros: number | null): string {
  if (micros == null) return "text-muted-foreground"
  if (micros > 0) return "text-emerald-300"
  if (micros < 0) return "text-rose-300"
  return "text-foreground"
}

function kindLabel(kind: TxKind): string {
  if (kind === "pack") return "Pack"
  if (kind === "buy") return "Buy"
  return "Sale"
}

function returnedLabel(transaction: LedgerTransaction): string {
  if (transaction.flags.includes("unconfirmed")) {
    const amount = formatUsd(transaction.unconfirmedReturnMicros)
    return amount === "Unavailable" ? "Unconfirmed" : `Unconfirmed ${amount}`
  }
  return formatUsd(transaction.returnedMicros)
}

function subscribeNoop() {
  return () => {}
}

export function Dashboard() {
  const router = useRouter()
  const params = useSearchParams()
  const initial = params.get("wallet")?.trim() ?? ""
  const requested = isSolanaAddress(initial) ? initial : ""
  const deviceZone = useSyncExternalStore(subscribeNoop, detectTimeZone, () => DEFAULT_TIME_ZONE)
  const [wallet, setWallet] = useState(initial)
  const [report, setReport] = useState<WalletReport | null>(null)
  const [failure, setFailure] = useState<{ wallet: string; message: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE)
  const [range, setRange] = useState<RangeKey>("30D")
  const [bucket, setBucket] = useState<Bucket>("day")
  const [kind, setKind] = useState<"all" | TxKind>("all")
  const [query, setQuery] = useState("")
  const [showRefunded, setShowRefunded] = useState(false)
  const [page, setPage] = useState(0)

  const invalidInitial = initial.length > 0 && !requested
  const error =
    formError ??
    (invalidInitial
      ? "Enter a valid Solana wallet address."
      : failure && failure.wallet === requested
        ? failure.message
        : null)
  const loading = Boolean(requested) && report?.wallet !== requested && !error
  const ready = Boolean(report && report.wallet === requested && !error)

  useEffect(() => {
    if (!requested) return
    const controller = new AbortController()
    const walletForRequest = requested
    let cancelled = false
    fetch(`/api/pnl?wallet=${encodeURIComponent(walletForRequest)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as WalletReport & { error?: string }
        if (!response.ok) {
          throw new Error(body.error || "Could not load this wallet.")
        }
        if (cancelled) return
        setFailure(null)
        setReport(body)
        setPage(0)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        if (caught instanceof Error && caught.name === "AbortError") return
        setReport(null)
        setFailure({
          wallet: walletForRequest,
          message: caught instanceof Error ? caught.message : "Could not load this wallet.",
        })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [requested, reload])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = wallet.trim()
    if (!isSolanaAddress(next)) {
      setFormError("Enter a valid Solana wallet address.")
      return
    }
    setFormError(null)
    setFailure(null)
    if (next === initial) {
      setReport(null)
      setReload((value) => value + 1)
      return
    }
    setReport(null)
    router.replace(`/?wallet=${encodeURIComponent(next)}`)
  }

  const summary = useMemo(
    () => (report ? summarize(report.transactions, timeZone) : null),
    [report, timeZone],
  )
  const series = useMemo(
    () =>
      report
        ? buildSeries(report.transactions, { timeZone, bucket, range })
        : null,
    [report, timeZone, bucket, range],
  )

  const visibleRows = useMemo(() => {
    if (!report) return []
    const needle = query.trim().toLowerCase()
    return report.transactions
      .filter((transaction) => (showRefunded ? true : transaction.counted))
      .filter((transaction) => (kind === "all" ? true : transaction.kind === kind))
      .filter((transaction) => {
        if (!needle) return true
        return (
          transaction.title.toLowerCase().includes(needle) ||
          (transaction.detail?.toLowerCase().includes(needle) ?? false) ||
          (transaction.signature?.toLowerCase().includes(needle) ?? false)
        )
      })
      .sort((a, b) => {
        const left = a.at ? Date.parse(a.at) : 0
        const right = b.at ? Date.parse(b.at) : 0
        return right - left
      })
  }, [report, showRefunded, kind, query])

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = visibleRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const zones = Array.from(new Set([DEFAULT_TIME_ZONE, deviceZone]))

  return (
    <div className="relative min-h-full">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.08_90/0.22),transparent_60%)]" />
      <main className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-3">
          <p className="text-xs font-medium tracking-[0.18em] text-[#E4C27A] uppercase">
            Solana · read only
          </p>
          <h1 className="font-display text-4xl leading-none text-balance sm:text-5xl">
            Collector Crypt PnL
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Cash in and cash out for one wallet. Pack pulls and house buybacks come from the
            public gacha history. Marketplace buys and sales are added when Collector Crypt
            publishes them. Nothing is signed.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
            <CardDescription>
              Paste a Solana address. Day totals use the timezone selected below, starting in
              Asia/Jakarta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="wallet">
                Solana wallet address
              </label>
              <Input
                id="wallet"
                name="wallet"
                value={wallet}
                onChange={(event) => setWallet(event.target.value)}
                placeholder="Solana wallet address"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 flex-1 font-mono text-sm"
              />
              <Button type="submit" className="h-11 sm:w-36" disabled={loading}>
                {loading ? "Loading…" : "Show PnL"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {error ? (
          <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        {loading ? <LoadingState /> : null}

        {ready && report && summary && series ? (
          <>
            <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-sm text-foreground">{shortWallet(report.wallet)}</p>
                <p className="text-xs text-muted-foreground">
                  Loaded {formatInstant(report.fetchedAt, timeZone)}
                </p>
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Timezone
                <select
                  aria-label="Timezone"
                  value={timeZone}
                  onChange={(event) => setTimeZone(event.target.value)}
                  className="h-9 rounded-lg border border-input bg-input/30 px-2 text-sm text-foreground"
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone === deviceZone && zone !== DEFAULT_TIME_ZONE
                        ? `${zone} (this device)`
                        : zone}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {report.truncated ? (
              <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Pack history was cut off before the last page. These totals are incomplete.
              </p>
            ) : null}

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Stat
                label="Net PnL"
                value={formatUsd(summary.netMicros, true)}
                toneClass={tone(summary.netMicros)}
                testId="summary-net"
                detail={
                  summary.spentPartial || summary.returnedPartial
                    ? "Partial — at least one amount is unavailable"
                    : "Buybacks and sales, minus packs and card buys"
                }
                display
              />
              <Stat
                label="Total spent"
                value={formatUsd(summary.spentMicros)}
                testId="summary-spent"
                detail={spentDetail(summary, report)}
              />
              <Stat
                label="Total returned"
                value={formatUsd(summary.returnedMicros)}
                testId="summary-returned"
                detail={returnedDetail(summary, report)}
              />
              <Stat
                label="Win / loss days"
                value={`${summary.winDays} win · ${summary.lossDays} loss`}
                testId="summary-days"
                detail={
                  summary.flatDays || summary.unscoredDays
                    ? `${summary.flatDays} flat${summary.unscoredDays ? ` · ${summary.unscoredDays} unscored` : ""}`
                    : "Days with activity, in the selected timezone"
                }
              />
              <Stat
                label="Best day"
                value={summary.best ? formatUsd(summary.best.pnlMicros, true) : "Unavailable"}
                toneClass={tone(summary.best?.pnlMicros ?? null)}
                testId="summary-best"
                detail={summary.best?.label ?? "No scored day yet"}
              />
              <Stat
                label="Worst day"
                value={summary.worst ? formatUsd(summary.worst.pnlMicros, true) : "Unavailable"}
                toneClass={tone(summary.worst?.pnlMicros ?? null)}
                testId="summary-worst"
                detail={summary.worst?.label ?? "No scored day yet"}
              />
            </section>

            <p className="text-xs leading-5 text-muted-foreground">
              {summary.packs.toLocaleString("en-US")} counted packs
              {summary.freeSpins ? ` · ${summary.freeSpins} free` : ""}
              {summary.refunded ? ` · ${summary.refunded} refunded spins excluded` : ""}
              {summary.kept
                ? ` · ${summary.kept} with no buyback yet, counted as $0 returned`
                : ""}
              {summary.unconfirmed
                ? ` · ${summary.unconfirmed} unconfirmed buybacks left out of returned`
                : ""}
              . Insured value is not part of cash PnL.
              {report.marketplace.status === "unavailable"
                ? ` Marketplace buys and sales are unavailable${report.marketplace.error ? ` (${report.marketplace.error})` : ""}.`
                : ` Marketplace buys ${formatUsd(summary.buySpentMicros)}, sales ${formatUsd(summary.saleReturnedMicros)}.`}
              {report.marketplace.status === "ok" && report.marketplace.ignored
                ? ` ${report.marketplace.ignored} other marketplace events are not cash.`
                : ""}
            </p>

            <Card>
              <CardHeader>
                <CardTitle>PnL over time</CardTitle>
                <CardDescription>
                  Bars are the profit or loss inside each bucket. The line is the running total
                  of those bars, starting at zero for the selected range. Summary cards stay on
                  the full history.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Range">
                    {RANGES.map((item) => (
                      <Button
                        key={item}
                        type="button"
                        size="sm"
                        variant={range === item ? "default" : "outline"}
                        aria-pressed={range === item}
                        onClick={() => setRange(item)}
                      >
                        {item === "ALL" ? "All" : item}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Bucket">
                    {BUCKETS.map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        size="sm"
                        variant={bucket === item.id ? "default" : "outline"}
                        aria-pressed={bucket === item.id}
                        onClick={() => setBucket(item.id)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-[#3DDC97]" /> Positive
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-[#FF6B6B]" /> Negative
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 bg-[#E4C27A]" /> Cumulative
                  </span>
                </div>
                {series.points.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    No dated activity in this range.
                  </p>
                ) : (
                  <div
                    data-testid="pnl-chart"
                    data-points={series.points.length}
                    data-bucket={bucket}
                    data-range={range}
                    data-net={series.rangeNetMicros}
                  >
                    <PnlChart points={series.points} />
                  </div>
                )}
                <p data-testid="chart-summary" className="text-sm text-muted-foreground">
                  {series.points.length}{" "}
                  {bucket === "day"
                    ? series.points.length === 1
                      ? "day"
                      : "days"
                    : bucket === "week"
                      ? series.points.length === 1
                        ? "week"
                        : "weeks"
                      : series.points.length === 1
                        ? "month"
                        : "months"}{" "}
                  · range net {formatUsd(series.rangeNetMicros, true)}
                  {series.incompleteCount
                    ? ` · ${series.incompleteCount} transactions with an unavailable amount are left off the bars`
                    : ""}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Transactions</CardTitle>
                <CardDescription>
                  {visibleRows.length.toLocaleString("en-US")} shown
                  {report.transactions.length !== visibleRows.length
                    ? ` of ${report.transactions.length.toLocaleString("en-US")}`
                    : ""}
                  . Times are {timeZone}.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Transaction type">
                    {(
                      [
                        ["all", "All"],
                        ["pack", "Packs"],
                        ["buy", "Buys"],
                        ["sale", "Sales"],
                      ] as const
                    ).map(([id, label]) => (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={kind === id ? "default" : "outline"}
                        aria-pressed={kind === id}
                        onClick={() => {
                          setKind(id)
                          setPage(0)
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setPage(0)
                    }}
                    placeholder="Search card or signature"
                    aria-label="Search transactions"
                    className="h-9 lg:ml-auto lg:max-w-xs"
                  />
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showRefunded}
                      onChange={(event) => {
                        setShowRefunded(event.target.checked)
                        setPage(0)
                      }}
                      className="size-4 accent-[#E4C27A]"
                    />
                    Refunded
                  </label>
                </div>

                {pageRows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No transactions match this filter.
                  </p>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs tracking-wide text-muted-foreground uppercase">
                          <tr>
                            <th className="py-2 pr-3 font-medium">Time</th>
                            <th className="py-2 pr-3 font-medium">Type</th>
                            <th className="py-2 pr-3 font-medium">Card</th>
                            <th className="py-2 pr-3 text-right font-medium">Spent</th>
                            <th className="py-2 pr-3 text-right font-medium">Returned</th>
                            <th className="py-2 pr-3 text-right font-medium">PnL</th>
                            <th className="py-2 font-medium">Tx</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((transaction) => (
                            <TransactionRow
                              key={transaction.id}
                              transaction={transaction}
                              timeZone={timeZone}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <ul className="flex flex-col gap-3 md:hidden">
                      {pageRows.map((transaction) => (
                        <li key={transaction.id}>
                          <TransactionCard transaction={transaction} timeZone={timeZone} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {visibleRows.length > PAGE_SIZE ? (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={safePage === 0}
                      onClick={() => setPage(safePage - 1)}
                    >
                      Previous
                    </Button>
                    <span className="text-muted-foreground">
                      {safePage + 1} / {pageCount}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={safePage >= pageCount - 1}
                      onClick={() => setPage(safePage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : null}

        {!requested && !error && !loading ? (
          <Card>
            <CardHeader>
              <CardTitle>What gets counted</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-6 text-muted-foreground">
              <p>A pack costs its spin price in USDC. A confirmed buyback is money back, booked on the spin date, not the buyback date.</p>
              <p>Refunded spins are left out. A card with no buyback is $0 returned. An unconfirmed buyback amount is shown on the row and kept out of the total.</p>
              <p>Marketplace sales you received and cards you bought are included when the public activity feed returns them. Lists, offers, and transfers are not.</p>
            </CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  )
}

function spentDetail(
  summary: ReturnType<typeof summarize>,
  report: WalletReport,
): string {
  const packs = `Packs ${formatUsd(summary.packSpentMicros)}`
  if (report.marketplace.status === "unavailable") return `${packs} · card buys unavailable`
  return `${packs} · card buys ${formatUsd(summary.buySpentMicros)}`
}

function returnedDetail(
  summary: ReturnType<typeof summarize>,
  report: WalletReport,
): string {
  const buybacks = `Buybacks ${formatUsd(summary.packReturnedMicros)}`
  if (report.marketplace.status === "unavailable") return `${buybacks} · sales unavailable`
  return `${buybacks} · sales ${formatUsd(summary.saleReturnedMicros)}`
}

function Stat({
  label,
  value,
  detail,
  toneClass,
  testId,
  display = false,
}: {
  label: string
  value: string
  detail: string
  toneClass?: string
  testId: string
  display?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          data-testid={testId}
          className={`text-2xl tabular-nums ${display ? "font-display text-3xl" : ""} ${toneClass ?? ""}`}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: 6 }, (_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-3 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function TransactionRow({
  transaction,
  timeZone,
}: {
  transaction: LedgerTransaction
  timeZone: string
}) {
  const href = explorerUrl(transaction.signature)
  const buybackHref = explorerUrl(transaction.buybackSignature)
  return (
    <tr className="border-t border-white/10 align-top">
      <td className="py-3 pr-3 whitespace-nowrap text-muted-foreground">
        {formatInstant(transaction.at, timeZone)}
      </td>
      <td className="py-3 pr-3">
        <Badge variant={transaction.counted ? "secondary" : "outline"}>{kindLabel(transaction.kind)}</Badge>
      </td>
      <td className="py-3 pr-3">
        <p className="max-w-xs">{transaction.title}</p>
        <p className="text-xs text-muted-foreground">
          {[transaction.detail, sourceLabel(transaction.source), transaction.flags.includes("kept") ? "No buyback" : null, transaction.flags.includes("free") ? "Free spin" : null, transaction.flags.includes("refunded") ? "Refunded" : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </td>
      <td className="py-3 pr-3 text-right tabular-nums">{formatUsd(transaction.spentMicros)}</td>
      <td className="py-3 pr-3 text-right tabular-nums">{returnedLabel(transaction)}</td>
      <td className={`py-3 pr-3 text-right tabular-nums ${tone(transaction.pnlMicros)}`}>
        {transaction.counted ? formatUsd(transaction.pnlMicros, true) : "Excluded"}
      </td>
      <td className="py-3">
        <TxLinks href={href} buybackHref={buybackHref} />
      </td>
    </tr>
  )
}

function TransactionCard({
  transaction,
  timeZone,
}: {
  transaction: LedgerTransaction
  timeZone: string
}) {
  return (
    <article className="rounded-xl border border-white/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Badge variant={transaction.counted ? "secondary" : "outline"}>{kindLabel(transaction.kind)}</Badge>
          <p className="mt-2 text-sm">{transaction.title}</p>
          <p className="text-xs text-muted-foreground">
            {formatInstant(transaction.at, timeZone)}
            {transaction.detail ? ` · ${transaction.detail}` : ""}
            {transaction.flags.includes("kept") ? " · No buyback" : ""}
            {transaction.flags.includes("free") ? " · Free spin" : ""}
            {transaction.flags.includes("refunded") ? " · Refunded" : ""}
          </p>
        </div>
        <p className={`text-sm font-medium tabular-nums ${tone(transaction.pnlMicros)}`}>
          {transaction.counted ? formatUsd(transaction.pnlMicros, true) : "Excluded"}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Spent</dt>
          <dd className="tabular-nums">{formatUsd(transaction.spentMicros)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Returned</dt>
          <dd className="tabular-nums">{returnedLabel(transaction)}</dd>
        </div>
      </dl>
      <div className="mt-2">
        <TxLinks
          href={explorerUrl(transaction.signature)}
          buybackHref={explorerUrl(transaction.buybackSignature)}
        />
      </div>
    </article>
  )
}

function TxLinks({ href, buybackHref }: { href: string | null; buybackHref: string | null }) {
  if (!href && !buybackHref) return <span className="text-xs text-muted-foreground">Unavailable</span>
  return (
    <div className="flex gap-3 text-xs">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#E4C27A] hover:underline">
          Spin <ExternalLink className="size-3" />
        </a>
      ) : null}
      {buybackHref ? (
        <a href={buybackHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#E4C27A] hover:underline">
          Buyback <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  )
}
