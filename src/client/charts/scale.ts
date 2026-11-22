import { useLayoutEffect, useRef, useState } from 'react'
import { dateFromDay, dayNumber, MONTHS } from '../../shared/dates'

export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export type YScale = {
  toY: (v: number) => number
  ticks: number[]
  log: boolean
  min: number
  max: number
}

export function niceStep(range: number, target: number): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1
  const raw = range / Math.max(1, target)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
}

export function linearTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  const step = niceStep(max - min, target)
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

export function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(min))
  const hi = Math.ceil(Math.log10(max))
  const decades = hi - lo
  const mult = decades <= 1 ? [1, 2, 5] : decades <= 3 ? [1, 3] : [1]
  const out: number[] = []
  for (let e = lo; e <= hi; e++) for (const m of mult) {
    const v = m * 10 ** e
    if (v >= min * 0.999 && v <= max * 1.001) out.push(Number(v.toPrecision(6)))
  }
  return out.length >= 2 ? out : linearTicks(min, max, 3)
}

/** Build a y-scale over [lo, hi] values mapped to [bottom, top] pixels. */
export function yScale(values: number[], top: number, bottom: number, opts: { log?: boolean; pad?: number; ticks?: number } = {}): YScale {
  const finite = values.filter(Number.isFinite)
  let min = finite.length ? Math.min(...finite) : 0
  let max = finite.length ? Math.max(...finite) : 1
  const log = Boolean(opts.log) && min > 0
  if (log) {
    let lmin = Math.log10(min)
    let lmax = Math.log10(max)
    if (lmax - lmin < 0.2) {
      lmin -= 0.1
      lmax += 0.1
    }
    const pad = (lmax - lmin) * (opts.pad ?? 0.08)
    lmin -= pad
    lmax += pad
    const toY = (v: number) => bottom - ((Math.log10(Math.max(v, 1e-12)) - lmin) / (lmax - lmin)) * (bottom - top)
    return { toY, ticks: logTicks(10 ** lmin, 10 ** lmax), log: true, min: 10 ** lmin, max: 10 ** lmax }
  }
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1
    min -= d
    max += d
  }
  const pad = (max - min) * (opts.pad ?? 0.08)
  // Keep a zero floor when the data are all non-negative and padding would cross it.
  const lo = min >= 0 && min - pad < 0 ? 0 : min - pad
  const hi = max + pad
  const toY = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top)
  return { toY, ticks: linearTicks(lo, hi, opts.ticks ?? 4), log: false, min: lo, max: hi }
}

export function shouldAutoLog(values: number[]): boolean {
  if (values.length < 3 || values.some((v) => v <= 0)) return false
  return Math.max(...values) / Math.min(...values) >= 20
}

/** Calendar-aligned ticks (month starts) for a day-number domain. */
export type TimeTick = { day: number; label: string; /** January 1st: drawn bolder so years stand out. */ year: boolean }

export function timeTicks(start: number, end: number, width: number): TimeTick[] {
  const maxTicks = Math.max(2, Math.floor(width / 72))
  const months = (end - start) / 30.44
  const stride = [1, 2, 3, 6, 12, 24, 36, 60].find((s) => months / s <= maxTicks) ?? 120
  const first = dateFromDay(start)
  let y = Number(first.slice(0, 4))
  let m = Number(first.slice(5, 7)) - 1
  const out: TimeTick[] = []
  // Advance to the first aligned month start inside the domain.
  for (let guard = 0; guard < 2000; guard++) {
    const day = dayNumber(`${y}-${String(m + 1).padStart(2, '0')}-01`)
    const aligned = stride >= 12 ? m === 0 && y % (stride / 12) === 0 : m % stride === 0
    if (day > end) break
    if (day >= start && aligned) {
      // Year starts read as the year itself; the first tick carries its year so the axis is never ambiguous.
      const label = m === 0 ? String(y) : !out.length ? `${MONTHS[m]} '${String(y).slice(-2)}` : MONTHS[m]
      out.push({ day, label, year: m === 0 })
    }
    m++
    if (m > 11) {
      m = 0
      y++
    }
  }
  return out
}

export function formatTick(v: number): string {
  const a = Math.abs(v)
  if (a >= 10000) return `${Math.round(v / 1000)}k`
  if (a >= 100 || Number.isInteger(v)) return String(Math.round(v))
  if (a >= 1) return String(Number(v.toFixed(1)))
  return String(Number(v.toPrecision(2)))
}
