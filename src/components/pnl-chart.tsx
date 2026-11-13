"use client"

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
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

type CandleProps = {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: ChartRow
}

function PnlCandle({ x = 0, y = 0, width = 0, height = 0, payload }: CandleProps) {
  if (!payload || width <= 0) return null
  const fill = payload.pnl > 0 ? POSITIVE : payload.pnl < 0 ? NEGATIVE : FLAT
  const bodyWidth = Math.max(2, Math.min(14, width * 0.62))
  const bodyX = x + (width - bodyWidth) / 2
  const wickX = x + width / 2
  const bodyHeight = Math.max(height, 1.5)
  return (
    <g>
      <line
        x1={wickX}
        x2={wickX}
        y1={y - 2}
        y2={y + bodyHeight + 2}
        stroke={fill}
        strokeWidth={1}
      />
      <rect x={bodyX} y={y} width={bodyWidth} height={bodyHeight} rx={1.5} fill={fill} />
    </g>
  )
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

function domain(values: number[]): [number, number] {
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const min = Math.min(0, dataMin)
  const max = Math.max(0, dataMax)
  const span = Math.max(max - min, 1)
  const pad = span * 0.08
  return [min - (min < 0 ? pad : 0), max + (max > 0 ? pad : span * 0.03)]
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
  const tickGap = rows.length > 24 ? 48 : 28

  return (
    <div className="w-full min-w-0">
      <div className="h-44 w-full sm:h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} syncId="pnl" margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pnl-curve" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LINE} stopOpacity={0.35} />
                <stop offset="100%" stopColor={LINE} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" hide />
            <YAxis
              tickFormatter={(value: number) => formatAxisUsd(Math.round(value * 1_000_000))}
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
              domain={domain(rows.map((row) => row.cumulative))}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(228,194,122,0.35)" }} />
            <Area
              type="monotone"
              dataKey="cumulative"
              stroke={LINE}
              strokeWidth={2.5}
              fill="url(#pnl-curve)"
              dot={rows.length < 3}
              activeDot={{ r: 4, fill: LINE }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-32 w-full sm:h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} syncId="pnl" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={tickGap}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(value: number) => formatAxisUsd(Math.round(value * 1_000_000))}
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
              domain={domain(rows.map((row) => row.pnl))}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.28)" />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar dataKey="pnl" shape={<PnlCandle />} maxBarSize={18} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
