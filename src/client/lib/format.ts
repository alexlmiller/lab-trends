export function formatNumber(value: number | null | undefined, maxDecimals = 3): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const decimals = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 10 ? 1 : abs >= 1 ? 2 : maxDecimals
  return Number(value.toFixed(decimals)).toLocaleString(undefined, { maximumFractionDigits: decimals })
}

export function formatSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`
}

export function formatPct(value: number | null | undefined, signed = true): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const s = `${Math.abs(value * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%`
  return signed ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${s}` : s
}

export function formatR(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '—'
  return `${r < 0 ? '−' : ''}${Math.abs(r).toFixed(2).replace(/^0/, '')}`
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}
