// Derive chartable points from committed results. Raw values stay intact for
// display; numeric value is only used for position.
import { dayNumber, todayDate } from '../../shared/dates'
import { resultStatus, statusTone, type RangeStatus } from '../../shared/semantics'
import type { MarkerSeries, Result } from '../../shared/types'
import { unitKey } from '../../shared/units'

export type Point = {
  day: number
  date: string
  value: number
  raw: string
  censored: '<' | '>' | null
  status: RangeStatus
  flag: string | null
  refLow: number | null
  refHigh: number | null
  units: string | null
  resultId: string
  panelId: string
  facility: string | null
  tags: string[]
}

export function toPoint(r: Result): Point | null {
  if (r.value_numeric == null || !Number.isFinite(r.value_numeric)) return null
  const c = r.comparator ?? '='
  return {
    day: dayNumber(r.draw_date),
    date: r.draw_date,
    value: r.value_numeric,
    raw: r.raw_value,
    censored: c.startsWith('<') ? '<' : c.startsWith('>') ? '>' : null,
    status: resultStatus(r),
    flag: r.lab_flag,
    refLow: r.ref_low,
    refHigh: r.ref_high,
    units: r.raw_units,
    resultId: r.id,
    panelId: r.panel_id,
    facility: r.facility,
    tags: r.panel_tags,
  }
}

const cache = new WeakMap<MarkerSeries, Point[]>()

export function pointsOf(m: MarkerSeries): Point[] {
  let pts = cache.get(m)
  if (!pts) {
    pts = m.results.map(toPoint).filter((p): p is Point => p !== null).sort((a, b) => a.day - b.day)
    cache.set(m, pts)
  }
  return pts
}

/** The colour a point outside its range is drawn in, or null for one drawn in its series colour. */
export function statusColor(status: RangeStatus): string | null {
  const tone = statusTone(status)
  return tone ? `var(--color-${tone})` : null
}

/** How a status reads after a value: "5.9 above range". */
export const STATUS_PHRASE: Record<RangeStatus, string> = { low: 'below range', high: 'above range', flagged: 'flagged by the lab', in: 'in range', unknown: 'no range reported' }

export function latestResult(m: MarkerSeries): Result | null {
  return m.results.length ? m.results[m.results.length - 1] : null
}

export function unitsSummary(m: MarkerSeries): { units: string | null; mixed: { units: string; count: number }[] } {
  const counts = new Map<string, { units: string; count: number }>()
  for (const r of m.results) {
    const k = unitKey(r.raw_units)
    if (!k || !r.raw_units) continue
    const entry = counts.get(k) ?? { units: r.raw_units.trim(), count: 0 }
    entry.count++
    counts.set(k, entry)
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count)
  const latest = latestResult(m)?.raw_units ?? sorted[0]?.units ?? m.default_units
  return { units: latest ?? null, mixed: sorted.length > 1 ? sorted : [] }
}

export type RangeKey = '6m' | '1y' | '3y' | '5y' | 'all'

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: '3y', label: '3Y' },
  { value: '5y', label: '5Y' },
  { value: 'all', label: 'All' },
]

/** One window shared by every series: [start, end] in day numbers. */
export function windowFor(range: RangeKey, allPoints: Pick<Point, 'day'>[][]): [number, number] {
  const days = allPoints.flat().map((p) => p.day)
  const today = dayNumber(todayDate())
  const last = days.length ? Math.max(...days) : today
  const end = Math.max(last, Math.min(today, last + 45))
  // Windows never run into the future: there is nothing to plot after today.
  const limit = latestDay(allPoints)
  if (range === 'all') {
    const first = days.length ? Math.min(...days) : end - 365
    const pad = Math.max(10, Math.round((end - first) * 0.02))
    return [first - pad, Math.min(end + pad, limit)]
  }
  const span = { '6m': 183, '1y': 365, '3y': 1096, '5y': 1826 }[range]
  // Never open on empty years before the first draw: a window longer than the history shows all of it.
  const first = days.length ? Math.min(...days) : end - span
  const pad = Math.max(10, Math.round((end - first) * 0.02))
  return [Math.max(end - span, first - pad), Math.min(end + 7, limit)]
}

/** The furthest a window may reach: today, or the last draw if a draw is dated later. */
export function latestDay(allPoints: Pick<Point, 'day'>[][]): number {
  const today = dayNumber(todayDate())
  return Math.max(today, ...allPoints.flat().map((p) => p.day))
}

export const SERIES_COLORS = ['var(--color-s1)', 'var(--color-s2)', 'var(--color-s3)', 'var(--color-s4)', 'var(--color-s5)', 'var(--color-s6)']

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]
}
