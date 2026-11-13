export const DEFAULT_TIME_ZONE = "Asia/Jakarta"

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function pad(value: number): string {
  return String(value).padStart(2, "0")
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function addDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function addMonths(key: string, months: number): string {
  const [year, month] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, 1))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
}

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: string
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  })
  const map: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value
  }
  let year = Number(map.year)
  let month = Number(map.month)
  let day = Number(map.day)
  let hour = Number(map.hour)
  if (hour === 24) {
    const next = addDays(isoDate(year, month, day), 1)
    const [y, m, d] = next.split("-").map(Number)
    year = y
    month = m
    day = d
    hour = 0
  }
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday ?? "",
  }
}

export function dayKey(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone)
  return isoDate(parts.year, parts.month, parts.day)
}

export function weekKey(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone)
  const index = WEEKDAY_INDEX[parts.weekday] ?? 0
  const mondayOffset = (index + 6) % 7
  return addDays(isoDate(parts.year, parts.month, parts.day), -mondayOffset)
}

export function monthKey(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone)
  return `${parts.year}-${pad(parts.month)}`
}

export function formatDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

export function formatInstant(iso: string | null, timeZone: string): string {
  if (!iso) return "Unavailable"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "Unavailable"
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
}

export function detectTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) return zone
  } catch {
    // Fall through to the default zone.
  }
  return DEFAULT_TIME_ZONE
}
