"use client"

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatAxisUsd, formatUsd } from "@/lib/money"
import type { SeriesPoint } from "@/lib/series"

const POSITIVE = "#3DDC97"
const NEGATIVE = "#FF6B6B"
const FLAT = "#71717a"
const LINE = "#E4C27A"

type ChartRow = {
  key: string
  label: string
  tooltip: string
  pnl: number
  cumulative: number
  pnlMicros: number
  cumulativeMicros: number
  incomplete: boolean
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: ChartRow }>
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/95 px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-zinc-100">{row.tooltip}</p>
      <p className={row.pnlMicros > 0 ? "text-emerald-300" : row.pnlMicros < 0 ? "text-rose-300" : "text-zinc-300"}>
        Period {formatUsd(row.pnlMicros, true)}
      </p>
      <p className="text-[#E4C27A]">Cumulative {formatUsd(row.cumulativeMicros, true)}</p>
      {row.incomplete ? (
        <p className="mt-1 text-zinc-400">Some amounts in this period are unavailable.</p>
      ) : null}
    </div>
  )
}

export function PnlChart({ points }: { points: SeriesPoint[] }) {
  const rows: ChartRow[] = points.map((point) => ({
    key: point.key,
    label: point.label,
    tooltip: point.tooltip,
    pnl: point.pnlMicros / 1_000_000,
    cumulative: point.cumulativeMicros / 1_000_000,
    pnlMicros: point.pnlMicros,
    cumulativeMicros: point.cumulativeMicros,
    incomplete: point.incomplete,
  }))
  const values = rows.flatMap((row) => [row.pnl, row.cumulative, 0])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max((max - min) * 0.12, 1)

  return (
    <div className="h-72 w-full min-w-0 overflow-x-auto sm:h-80">
      <div
        className="h-full"
        style={{ minWidth: Math.max(560, rows.length * (rows.length > 60 ? 16 : 28)) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(value: number) => formatAxisUsd(Math.round(value * 1_000_000))}
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={56}
              domain={[min - pad, max + pad]}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.28)" />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={22}>
              {rows.map((row) => (
                <Cell
                  key={row.key}
                  fill={row.pnl > 0 ? POSITIVE : row.pnl < 0 ? NEGATIVE : FLAT}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke={LINE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: LINE }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
