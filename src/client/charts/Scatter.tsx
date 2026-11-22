// Paired-draw scatter: x = marker A, y = marker B, coloured by date so the
// direction of travel is visible. Includes an OLS line on the plotted scale.
import { useState } from 'react'
import { dateFromDay, formatDate } from '../../shared/dates'
import { linearFit, type Pair } from '../../shared/stats'
import { formatTick, linearTicks, logTicks, useElementWidth } from './scale'

type Axis = { label: string; units: string | null; refLow?: number | null; refHigh?: number | null; raw?: Map<number, string> }

export function Scatter({ pairs, x, y, log = false, height = 320 }: { pairs: Pair[]; x: Axis; y: Axis; log?: boolean; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const usable = log ? pairs.filter((p) => p.a > 0 && p.b > 0) : pairs
  const m = { top: 22, right: 16, bottom: 40, left: 52 }
  const w = Math.max(10, width - m.left - m.right)
  const h = height - m.top - m.bottom
  const tf = (v: number) => (log ? Math.log10(v) : v)
  const ext = (vals: number[]) => {
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (lo === hi) {
      lo -= Math.abs(lo) * 0.1 || 1
      hi += Math.abs(hi) * 0.1 || 1
    }
    const pad = (hi - lo) * 0.08
    return [lo - pad, hi + pad] as const
  }
  if (!usable.length) return <div ref={ref} className="grid h-40 place-items-center text-[13px] text-ink-faint">No paired draws</div>
  const [x0, x1] = ext(usable.map((p) => tf(p.a)))
  const [y0, y1] = ext(usable.map((p) => tf(p.b)))
  const px = (v: number) => m.left + ((tf(v) - x0) / (x1 - x0)) * w
  const py = (v: number) => m.top + h - ((tf(v) - y0) / (y1 - y0)) * h
  const xt = log ? logTicks(10 ** x0, 10 ** x1) : linearTicks(x0, x1, Math.max(3, Math.round(w / 90)))
  const yt = log ? logTicks(10 ** y0, 10 ** y1) : linearTicks(y0, y1, 4)
  const fit = linearFit(usable.map((p) => tf(p.a)), usable.map((p) => tf(p.b)))
  const days = usable.map((p) => p.day)
  const dMin = Math.min(...days)
  const dMax = Math.max(...days)
  const shade = (d: number) => 0.25 + 0.75 * ((d - dMin) / (dMax - dMin || 1))
  const hp = hover != null ? usable[hover] : null
  const clampX = (v: number) => Math.min(m.left + w, Math.max(m.left, v))
  const clampY = (v: number) => Math.min(m.top + h, Math.max(m.top, v))
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width ? (
        <svg width={width} height={height} className="block">
          {x.refLow != null || x.refHigh != null ? (
            <rect
              x={clampX(x.refLow != null ? px(x.refLow) : m.left)}
              width={Math.max(0, clampX(x.refHigh != null ? px(x.refHigh) : m.left + w) - clampX(x.refLow != null ? px(x.refLow) : m.left))}
              y={m.top}
              height={h}
              fill="var(--color-band)"
            />
          ) : null}
          {y.refLow != null || y.refHigh != null ? (
            <rect
              y={clampY(y.refHigh != null ? py(y.refHigh) : m.top)}
              height={Math.max(0, clampY(y.refLow != null ? py(y.refLow) : m.top + h) - clampY(y.refHigh != null ? py(y.refHigh) : m.top))}
              x={m.left}
              width={w}
              fill="var(--color-band)"
            />
          ) : null}
          {yt.map((t) => (
            <g key={`y${t}`}>
              <line x1={m.left} x2={m.left + w} y1={py(t)} y2={py(t)} stroke="var(--color-line)" />
              <text x={m.left - 6} y={py(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-faint)">{formatTick(t)}</text>
            </g>
          ))}
          {xt.map((t) => (
            <g key={`x${t}`}>
              <line x1={px(t)} x2={px(t)} y1={m.top} y2={m.top + h} stroke="var(--color-line)" />
              <text x={px(t)} y={m.top + h + 15} textAnchor="middle" fontSize={11} fill="var(--color-ink-faint)">{formatTick(t)}</text>
            </g>
          ))}
          <text x={m.left + w / 2} y={height - 4} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--color-ink-dim)">
            {x.label} {x.units ? `(${x.units})` : ''}{log ? ' · log' : ''}
          </text>
          <text transform={`translate(12 ${m.top + h / 2}) rotate(-90)`} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--color-ink-dim)">
            {y.label} {y.units ? `(${y.units})` : ''}
          </text>
          {fit ? (
            <line
              x1={m.left}
              x2={m.left + w}
              y1={m.top + h - ((fit.intercept + fit.slope * x0 - y0) / (y1 - y0)) * h}
              y2={m.top + h - ((fit.intercept + fit.slope * x1 - y0) / (y1 - y0)) * h}
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              clipPath="inset(0)"
            />
          ) : null}
          {usable.map((p, i) => (
            <circle
              key={i}
              cx={px(p.a)}
              cy={py(p.b)}
              r={hover === i ? 6.5 : 5}
              fill="var(--color-accent)"
              fillOpacity={shade(p.day)}
              stroke="var(--color-surface)"
              strokeWidth={1.25}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
      ) : null}
      {hp ? (
        <div className="pointer-events-none absolute top-2 right-2 rounded-md border border-line-strong bg-surface/95 px-3 py-2 text-[12.5px] shadow-lg">
          <div className="font-semibold">{formatDate(dateFromDay(hp.day))}{hp.dayB !== hp.day ? ` / ${formatDate(dateFromDay(hp.dayB), 'short')}` : ''}</div>
          <div className="text-ink-dim">{x.label}: <b className="text-ink">{x.raw?.get(hp.day) ?? formatTick(hp.a)}</b></div>
          <div className="text-ink-dim">{y.label}: <b className="text-ink">{y.raw?.get(hp.dayB) ?? formatTick(hp.b)}</b></div>
        </div>
      ) : null}
      <div className="pointer-events-none absolute top-0 left-14 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
        <span>{formatDate(dateFromDay(dMin), 'month')}</span>
        <span className="h-1.5 w-12 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 25%, transparent), var(--color-accent))' }} />
        <span>{formatDate(dateFromDay(dMax), 'month')}</span>
      </div>
    </div>
  )
}
