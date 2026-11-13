const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatUsd(micros: number | null, signed = false): string {
  if (micros == null || !Number.isFinite(micros)) return "Unavailable"
  const formatted = usd.format(micros / 1_000_000)
  if (signed && micros > 0) return `+${formatted}`
  return formatted
}

export function formatAxisUsd(micros: number): string {
  const dollars = micros / 1_000_000
  const sign = dollars < 0 ? "-" : ""
  const abs = Math.abs(dollars)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`
  if (abs >= 100) return `${sign}$${Math.round(abs)}`
  return `${sign}$${abs.toFixed(0)}`
}

export function shortWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
}

export function explorerUrl(signatureOrUrl: string | null): string | null {
  if (!signatureOrUrl) return null
  if (signatureOrUrl.startsWith("http://") || signatureOrUrl.startsWith("https://")) {
    return signatureOrUrl
  }
  return `https://solscan.io/tx/${signatureOrUrl}`
}
