// Time-series chart for lab markers on a shared calendar axis. One y-axis only:
// compare markers with different units as stacked lanes (one chart each) or in
// a normalized mode, never on twin axes.
//
// Scale modes:
//  own   – the series' own units (several series share that one axis, so only
//          pass same-unit series together).
//  range – each value placed within its own draw's reported reference range:
//          linear from the low limit (or zero) to the upper limit, then
//          compressed above it (2× / 4× the upper limit), so one spike does not
//          flatten everything else.
//  z     – standard deviations from the series' mean within the window.
//  pct   – % change from the first draw in the window.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatDate } from '../../shared/dates'
import { mean, stdev } from '../../shared/stats'
import { chartOccurrences } from '../../shared/events'
import type { TimelineEvent } from '../../shared/types'
import { cx } from '../components/ui'
import { statusColor, type Point } from '../lib/series'
import { formatTick, shouldAutoLog, timeTicks, useElementWidth, yScale, type YScale } from './scale'

export type ChartSeries = {
  id: string
  label: string
  color: string
  units: string | null
  points: Point[]
  target?: { low: number | null; high: number | null } | null
  dashed?: boolean
}

export type ScaleMode = 'own' | 'range' | 'z' | 'pct'

type Props = {
  series: ChartSeries[]
  domain: [number, number]
  mode?: ScaleMode
  log?: 'auto' | 'on' | 'off'
  showRef?: boolean
  events?: TimelineEvent[]
  highlightStart?: string
  /** Draw the labelled events lane above the plot (rules and shading are always drawn). */
  eventLabels?: boolean
  height?: number
  hoverDay?: number | null
  onHoverDay?: (day: number | null) => void
  onPointClick?: (point: Point, series: ChartSeries) => void
  showXAxis?: boolean
  emptyLabel?: ReactNode
  /** Floating tooltip; turn off when values are displayed alongside the chart. */
  tooltip?: boolean
  /** Soft gradient under the first series (single-series charts). */
  area?: boolean
  /** Value tag next to the first series' latest point. */
  endTag?: boolean
  /** Direct labels at the right end of each line (normalized multi-series charts). */
  endLabels?: boolean
}

type PlotPoint = Point & { y: number; nv: number }
type Plotted = { s: ChartSeries; pts: PlotPoint[]; scale: YScale; dropped: number }

export const EVENT_COLORS: Record<string, string> = {
  medication: 'var(--color-accent)',
  procedure: 'var(--color-s5)',
  illness: 'var(--color-high)',
  location: 'var(--color-s2)',
  lifestyle: 'var(--color-s3)',
  other: 'var(--color-ink-faint)',
}

/** Range-mode position: 0 = low limit (or zero), 1 = upper limit, then log2 multiples above it. */
export function rangePosition(value: number, low: number | null, high: number | null): number | null {
  if (high != null && high > 0) {
    if (value > high) return 1 + Math.log2(value / high)
    const base = low != null && low < high ? low : 0
    return (value - base) / (high - base || 1)
  }
  if (low != null && low > 0) return value / low - 1
  return null
}

const LANE_H = 30
/** Phones: unlabelled marks in thin rows; tap one for its name. */
const LANE_H_COMPACT = 12

export function TimeSeriesChart({
  series,
  domain,
  mode = 'own',
  log = 'auto',
  showRef = true,
  events = [],
  highlightStart,
  eventLabels = true,
  height = 320,
  hoverDay,
  onHoverDay,
  onPointClick,
  showXAxis = true,
  emptyLabel,
  tooltip = true,
  area = false,
  endTag = false,
  endLabels = false,
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const [localHover, setLocalHover] = useState<number | null>(null)
  const [pointerIn, setPointerIn] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const hover = hoverDay !== undefined ? hoverDay : localHover
  const setHover = (d: number | null) => {
    setLocalHover(d)
    onHoverDay?.(d)
  }

  const [d0, d1] = domain
  const visibleEvents = chartOccurrences(events).filter((e) => {
    const end = e.end_date ? e.end_date : e.ongoing ? '9999-12-31' : e.start_date
    return end >= isoOf(d0) && e.start_date <= isoOf(d1)
  })
  const narrow = width < 560
  const labelGutter = endLabels ? (narrow ? 64 : 110) : endTag ? (narrow ? 44 : 62) : narrow ? 8 : 12
  const left = (narrow ? 38 : 48) + (mode === 'range' ? 6 : 0)
  const plotW = Math.max(10, width - left - labelGutter)
  const xOf = (day: number) => left + ((day - d0) / (d1 - d0 || 1)) * plotW
  const compactEvents = narrow
  const laneH = compactEvents ? LANE_H_COMPACT : LANE_H
  const lanes = layoutEventLanes(eventLabels ? visibleEvents : [], d0, d1, xOf, width, compactEvents)
  const laneCount = Math.max(0, ...Array.from(lanes.values(), (entry) => entry.lane + 1))
  const laneBlock = laneCount ? laneCount * laneH + (compactEvents ? 6 : 8) : 0
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => {
    if (!picked) return
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-event-ui]')) setPicked(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [picked])
  /** Where an event period sits in the lane block: start, end (null for a single day) and bar y. */
  const markOf = (e: TimelineEvent, lane: number) => {
    const x0 = xOf(Math.max(d0, dayOf(e.start_date)))
    const endDay = e.end_date ? dayOf(e.end_date) : e.ongoing ? d1 : null
    const x1 = endDay != null ? xOf(Math.min(d1, endDay)) : null
    return { x0, x1: x1 != null && x1 - x0 > 2 ? x1 : null, by: compactEvents ? 6 + lane * laneH : 22 + lane * laneH }
  }
  const totalH = height + laneBlock
  const margin = { top: laneBlock + 16, right: labelGutter, bottom: showXAxis ? 28 : 6, left }
  const top = margin.top
  const bottom = totalH - margin.bottom

  const plotted: Plotted[] = useMemo(() => {
    const ticks = Math.max(2, Math.round((bottom - top) / 56))
    const transformed = series.map((s) => {
      const inside = s.points.filter((p) => p.day >= d0 && p.day <= d1)
      const before = s.points.filter((p) => p.day < d0).at(-1)
      const after = s.points.find((p) => p.day > d1)
      const pts = [...(before ? [before] : []), ...inside, ...(after ? [after] : [])]
      const vals = inside.map((p) => p.value)
      const m = mean(vals)
      const sd = stdev(vals)
      const first = inside[0]?.value
      let dropped = 0
      const out = pts.flatMap((p) => {
        let nv: number | null = p.value
        if (mode === 'range') nv = rangePosition(p.value, p.refLow, p.refHigh)
        else if (mode === 'z') nv = sd > 0 ? (p.value - m) / sd : 0
        else if (mode === 'pct') nv = first ? p.value / first - 1 : null
        if (nv == null || !Number.isFinite(nv)) {
          if (p.day >= d0 && p.day <= d1) dropped++
          return []
        }
        return [{ ...p, nv }]
      })
      return { s, out, dropped, inside }
    })
    if (mode !== 'own') {
      const all = transformed.flatMap((t) => t.out.filter((p) => p.day >= d0 && p.day <= d1).map((p) => p.nv))
      const anchors = mode === 'range' ? [-0.15, 1.25] : mode === 'z' ? [-1.2, 1.2] : [0]
      const scale = yScale([...all, ...anchors], top, bottom, { pad: 0.06, ticks })
      if (mode === 'range') {
        const marks = [0, 1, 2, 3, 4].filter((t) => t >= scale.min && t <= scale.max)
        scale.ticks = marks.length ? marks : scale.ticks
      }
      return transformed.map((t) => ({ s: t.s, scale, dropped: t.dropped, pts: t.out.map((p) => ({ ...p, y: scale.toY(p.nv) })) }))
    }
    // Own units: one shared axis across the given series.
    const vals = transformed.flatMap((t) => t.inside.map((p) => p.value))
    const extra: number[] = []
    if (showRef) for (const p of transformed[0]?.inside ?? []) {
      if (p.refLow != null && p.refLow > 0) extra.push(p.refLow)
      if (p.refHigh != null) extra.push(p.refHigh)
    }
    const tg = transformed[0]?.s.target
    if (tg?.low != null) extra.push(tg.low)
    if (tg?.high != null) extra.push(tg.high)
    const useLog = log === 'on' ? vals.every((v) => v > 0) : log === 'auto' ? shouldAutoLog(vals) : false
    const lo = vals.length ? Math.min(...vals) : 0
    const hi = vals.length ? Math.max(...vals) : 1
    const span = hi - lo || Math.abs(hi) || 1
    const near = extra.filter((v) => (!useLog || v > 0) && v >= lo - span * 1.2 && v <= hi + span * 1.2)
    const scale = yScale([...vals, ...near], top, bottom, { log: useLog, ticks })
    return transformed.map((t) => ({ s: t.s, scale, dropped: 0, pts: t.out.map((p) => ({ ...p, y: scale.toY(p.value) })) }))
  }, [series, d0, d1, mode, log, showRef, top, bottom])

  const allDays = useMemo(
    () => [...new Set(plotted.flatMap((p) => p.pts.filter((x) => x.day >= d0 && x.day <= d1).map((x) => x.day)))].sort((a, b) => a - b),
    [plotted, d0, d1],
  )
  const hasData = allDays.length > 0

  const onMove = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !allDays.length) return
    const day = d0 + ((clientX - rect.left - margin.left) / plotW) * (d1 - d0)
    let best = allDays[0]
    for (const d of allDays) if (Math.abs(d - day) < Math.abs(best - day)) best = d
    if (best !== hover) setHover(best)
  }

  const primary = plotted[0]
  const ticksX = width ? timeTicks(d0, d1, plotW) : []
  const clipId = `clip-${uid}`
  const gradId = `grad-${uid}`
  const lastPrimary = primary?.pts.filter((p) => p.day >= d0 && p.day <= d1).at(-1)

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height: totalH }}>
      {width > 0 ? (
        <svg
          ref={svgRef}
          width={width}
          height={totalH}
          className="block touch-pan-y"
          onPointerMove={(e) => {
            if (!pointerIn) setPointerIn(true)
            onMove(e.clientX)
          }}
          onPointerDown={(e) => {
            setPointerIn(true)
            onMove(e.clientX)
          }}
          onPointerLeave={() => {
            setPointerIn(false)
            setHover(null)
          }}
          onClick={() => {
            if (hover == null || !onPointClick) return
            for (const p of plotted) {
              const hit = p.pts.find((x) => x.day === hover)
              if (hit) return onPointClick(hit, p.s)
            }
          }}
          style={{ cursor: onPointClick && hover != null ? 'pointer' : 'crosshair' }}
          role="img"
          aria-label={`Chart of ${series.map((s) => s.label).join(', ')}`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={margin.left} y={top - 8} width={plotW} height={bottom - top + 16} />
            </clipPath>
            {primary ? (
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={primary.s.color} stopOpacity={0.16} />
                <stop offset="1" stopColor={primary.s.color} stopOpacity={0} />
              </linearGradient>
            ) : null}
          </defs>

          {/* Normalized backgrounds */}
          {mode === 'range' && primary ? rangeZones(primary.scale, margin.left, plotW, top, bottom) : null}
          {mode === 'z' && primary ? (
            <rect x={margin.left} width={plotW} y={primary.scale.toY(1)} height={Math.max(0, primary.scale.toY(-1) - primary.scale.toY(1))} fill="var(--color-sunken)" />
          ) : null}

          {/* Grid */}
          {ticksX.map((t) => (
            <line key={`gx-${t.day}`} x1={xOf(t.day)} x2={xOf(t.day)} y1={top - 4} y2={bottom} stroke="var(--color-line)" strokeWidth={1} opacity={0.6} />
          ))}
          {primary
            ? primary.scale.ticks.map((t) => {
                const y = primary.scale.toY(t)
                if (y < top - 1 || y > bottom + 1) return null
                return <line key={`gy-${t}`} x1={margin.left} x2={margin.left + plotW} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} />
              })
            : null}

          {/* Events: faint spans and rules through the plot, labelled lane above it. */}
          {visibleEvents.map((e) => {
            const x0 = xOf(Math.max(d0, dayOf(e.start_date)))
            const endDay = e.end_date ? dayOf(e.end_date) : e.ongoing ? d1 : null
            const x1 = endDay != null ? xOf(Math.min(d1, endDay)) : null
            const color = EVENT_COLORS[e.kind] ?? EVENT_COLORS.other
            return (
              <g key={`ev-${e.id}`}>
                {x1 != null && x1 - x0 > 1 ? <rect x={x0} y={top - 4} width={x1 - x0} height={bottom - top + 4} fill={color} opacity={e.start_date === highlightStart || e.id === picked ? 0.16 : 0.05} /> : null}
                <line x1={x0} x2={x0} y1={top - 4} y2={bottom} stroke={color} strokeWidth={e.start_date === highlightStart || e.id === picked ? 2 : 1} strokeDasharray="3 4" opacity={0.55} />
                {x1 != null && x1 - x0 > 1 ? <line x1={x1} x2={x1} y1={top - 4} y2={bottom} stroke={color} strokeWidth={1} strokeDasharray="1 4" opacity={0.45} /> : null}
              </g>
            )
          })}
          {laneCount && compactEvents ? (
            <text x={left - 6} y={12} textAnchor="end" fontSize={9.5} fill="var(--color-ink-faint)">
              Events
            </text>
          ) : null}
          {laneCount
            ? visibleEvents.map((e) => {
                const entry = lanes.get(e.id)
                if (!entry) return null
                const { x0, x1, by } = markOf(e, entry.lane)
                const color = EVENT_COLORS[e.kind] ?? EVENT_COLORS.other
                return (
                  <g key={`evl-${e.id}`}>
                    {x1 != null ? (
                      <rect x={x0} y={by} width={Math.max(4, x1 - x0)} height={5} rx={2.5} fill={color} opacity={e.id === picked ? 1 : 0.55} />
                    ) : (
                      <path d={`M${x0},${by - 2}L${x0 + 5},${by + 3}L${x0},${by + 8}L${x0 - 5},${by + 3}Z`} fill={color} />
                    )}
                    {entry.label ? (
                      <text x={entry.x} y={by - 5} fontSize={11} fontWeight={600} fill="var(--color-ink-dim)">
                        {entry.label}
                      </text>
                    ) : null}
                    <title>{`${e.label} · ${eventDates(e)}`}</title>
                  </g>
                )
              })
            : null}

          {/* Reference band (own units, first series), step-wise per draw. */}
          {mode === 'own' && showRef && primary ? <g clipPath={`url(#${clipId})`}>{refBand(primary, xOf, margin.left, margin.left + plotW, top, bottom)}</g> : null}

          {/* Target */}
          {mode === 'own' && primary?.s.target
            ? (['low', 'high'] as const).map((k) => {
                const v = primary.s.target?.[k]
                if (v == null) return null
                const y = primary.scale.toY(v)
                if (y < top || y > bottom) return null
                return (
                  <g key={`tg-${k}`}>
                    <line x1={margin.left} x2={margin.left + plotW} y1={y} y2={y} stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="6 4" />
                    <text x={margin.left + 6} y={k === 'high' ? y - 5 : y + 13} fontSize={10.5} fontWeight={600} fill="var(--color-accent)">
                      your target {k === 'high' ? '≤' : '≥'} {formatTick(v)}
                    </text>
                  </g>
                )
              })
            : null}

          {/* Y axis labels */}
          {primary
            ? primary.scale.ticks.map((t) => {
                const y = primary.scale.toY(t)
                if (y < top - 1 || y > bottom + 1) return null
                return (
                  <text key={`yl-${t}`} x={margin.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-faint)" className="tabular">
                    {tickLabel(t, mode)}
                  </text>
                )
              })
            : null}
          {primary && mode === 'own' && height >= 180 ? (
            <text x={margin.left - 8} y={top - 6} textAnchor="end" fontSize={10} fill="var(--color-ink-faint)">
              {primary.s.units ?? ''}
              {primary.scale.log ? ' · log' : ''}
            </text>
          ) : null}

          {/* X axis */}
          <line x1={margin.left} x2={margin.left + plotW} y1={bottom} y2={bottom} stroke="var(--color-line-strong)" />
          {showXAxis
            ? ticksX.map((t) => (
                <g key={`xt-${t.day}`}>
                  {t.year ? <line x1={xOf(t.day)} x2={xOf(t.day)} y1={bottom} y2={bottom + 5} stroke="var(--color-ink-faint)" strokeWidth={1.25} /> : null}
                  <text
                    x={xOf(t.day)}
                    y={totalH - 9}
                    textAnchor="middle"
                    fontSize={t.year ? 11.5 : 11}
                    fontWeight={t.year ? 650 : 400}
                    fill={t.year ? 'var(--color-ink-dim)' : 'var(--color-ink-faint)'}
                  >
                    {t.label}
                  </text>
                </g>
              ))
            : null}

          {/* Area + lines */}
          <g clipPath={`url(#${clipId})`}>
            {area && primary && mode === 'own' && primary.pts.length > 1 ? (
              <path
                d={`${linePath(primary.pts, xOf)}L${xOf(primary.pts.at(-1)!.day).toFixed(1)},${bottom}L${xOf(primary.pts[0].day).toFixed(1)},${bottom}Z`}
                fill={`url(#${gradId})`}
              />
            ) : null}
            {plotted.map((p, i) => (
              <path
                key={`ln-${p.s.id}`}
                d={linePath(p.pts, xOf)}
                fill="none"
                stroke={p.s.color}
                strokeWidth={i === 0 ? 2 : 1.75}
                strokeDasharray={p.s.dashed ? '6 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </g>

          {/* Crosshair */}
          {hover != null && hover >= d0 && hover <= d1 ? (
            <line x1={xOf(hover)} x2={xOf(hover)} y1={top - 6} y2={bottom} stroke="var(--color-ink-faint)" strokeWidth={1} />
          ) : null}

          {/* Points: status fills the dot; censored values are open triangles. */}
          {plotted.map((p) =>
            p.pts
              .filter((x) => x.day >= d0 && x.day <= d1)
              .map((x) => {
                const cxp = xOf(x.day)
                const active = hover === x.day
                const isLast = p === primary && x === lastPrimary
                const out = statusColor(x.status) !== null
                const fill = statusColor(x.status) ?? p.s.color
                const r = (out ? 4.5 : 3.5) + (isLast ? 1 : 0)
                return (
                  <g key={`pt-${p.s.id}-${x.resultId}`}>
                    {active ? <circle cx={cxp} cy={x.y} r={r + 5} fill="none" stroke={p.s.color} strokeWidth={1.5} opacity={0.6} /> : null}
                    {x.censored ? (
                      <path
                        d={x.censored === '<' ? `M${cxp - 5.5},${x.y - 4.5}L${cxp + 5.5},${x.y - 4.5}L${cxp},${x.y + 5.5}Z` : `M${cxp - 5.5},${x.y + 4.5}L${cxp + 5.5},${x.y + 4.5}L${cxp},${x.y - 5.5}Z`}
                        fill="var(--color-surface)"
                        stroke={p.s.color}
                        strokeWidth={1.75}
                      />
                    ) : (
                      <circle cx={cxp} cy={x.y} r={r} fill={fill} stroke="var(--color-surface)" strokeWidth={2} />
                    )}
                  </g>
                )
              })
          )}

          {/* Latest value tag */}
          {endTag && lastPrimary && mode === 'own' ? (
            <g>
              <rect
                x={xOf(lastPrimary.day) + 9}
                y={lastPrimary.y - 11}
                width={lastPrimary.raw.length * 7.4 + 14}
                height={22}
                rx={6}
                fill="var(--color-surface)"
                stroke={statusColor(lastPrimary.status) ?? 'var(--color-line-strong)'}
              />
              <text x={xOf(lastPrimary.day) + 16} y={lastPrimary.y + 4} fontSize={12} fontWeight={700} fill="var(--color-ink)" className="tabular">
                {lastPrimary.raw}
              </text>
            </g>
          ) : null}

          {/* Direct end labels, nudged apart */}
          {endLabels ? endLabelMarks(plotted, xOf, d0, d1, margin.left + plotW) : null}
        </svg>
      ) : null}

      {!hasData && width > 0 ? (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-faint">{emptyLabel ?? 'No numeric results in this range'}</div>
      ) : null}

      {laneCount && width > 0
        ? visibleEvents.map((e) => {
            const entry = lanes.get(e.id)
            if (!entry) return null
            const { x0, x1, by } = markOf(e, entry.lane)
            const labelEnd = entry.label ? entry.x + entry.label.length * 6.5 : -Infinity
            const a = Math.min(x1 == null ? x0 - 8 : x0 - 4, entry.label ? entry.x - 4 : Infinity)
            const b = Math.max(x1 == null ? x0 + 8 : x1 + 4, labelEnd + 4)
            const w = Math.max(24, b - a)
            return (
              <button
                key={`evb-${e.id}`}
                type="button"
                data-event-ui
                aria-label={`${e.label}, ${eventDates(e)}`}
                aria-expanded={picked === e.id}
                onClick={() => setPicked(picked === e.id ? null : e.id)}
                className="absolute cursor-pointer rounded-sm"
                style={{ left: (a + b) / 2 - w / 2, top: compactEvents ? by - 3 : by - 17, width: w, height: compactEvents ? laneH : 26 }}
              />
            )
          })
        : null}
      {(() => {
        const e = picked ? visibleEvents.find((x) => x.id === picked) : undefined
        const entry = e && lanes.get(e.id)
        if (!e || !entry) return null
        const { x0, x1 } = markOf(e, entry.lane)
        const note = e.note || e.notes
        return (
          <div
            data-event-ui
            role="status"
            className="absolute z-10 w-max max-w-[220px] rounded-md border border-line-strong bg-surface/95 px-3 py-2 text-[12.5px] shadow-lg backdrop-blur"
            style={{ left: Math.max(4, Math.min((x1 == null ? x0 : (x0 + x1) / 2) - 24, width - 224)), top: laneBlock + 2 }}
          >
            <div className="font-semibold text-ink">{e.label}</div>
            <div className="text-[11.5px] text-ink-dim tabular">{eventDates(e)}</div>
            {note ? <div className="mt-1 line-clamp-3 text-[11.5px] text-ink-dim">{note}</div> : null}
          </div>
        )
      })()}
      {tooltip && hover != null && pointerIn && width > 0 ? <Tooltip day={hover} plotted={plotted} events={visibleEvents} x={xOf(hover)} width={width} mode={mode} /> : null}
    </div>
  )
}

function Tooltip({ day, plotted, events, x, width, mode }: { day: number; plotted: Plotted[]; events: TimelineEvent[]; x: number; width: number; mode: ScaleMode }) {
  const date = isoOf(day)
  const rows = plotted.map((p) => {
    const exact = p.pts.find((pt) => pt.day === day)
    const near = exact ?? p.pts.reduce<PlotPoint | undefined>((best, pt) => (Math.abs(pt.day - day) <= 21 && (!best || Math.abs(pt.day - day) < Math.abs(best.day - day)) ? pt : best), undefined)
    return { p, pt: near, exact: Boolean(exact) }
  })
  const tags = [...new Set(rows.flatMap((r) => (r.exact && r.pt ? r.pt.tags : [])))]
  const facility = rows.find((r) => r.exact && r.pt?.facility)?.pt?.facility
  const activeEvents = events.filter((e) => e.start_date <= date && (e.end_date ? e.end_date >= date : e.ongoing || e.start_date === date))
  const right = x > width * 0.6
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 w-max max-w-[300px] rounded-md border border-line-strong bg-surface/95 px-3 py-2 text-[12.5px] shadow-lg backdrop-blur"
      style={right ? { right: width - x + 14 } : { left: x + 14 }}
    >
      <div className="font-semibold text-ink">{formatDate(date)}</div>
      {facility || tags.length ? <div className="text-[11.5px] text-ink-faint">{[facility, ...tags].filter(Boolean).join(' · ')}</div> : null}
      <div className="mt-1 grid gap-0.5">
        {rows.map(({ p, pt, exact }) => (
          <div key={p.s.id} className="flex items-baseline gap-2">
            <span className="inline-block h-2 w-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: p.s.color }} />
            <span className="min-w-0 truncate text-ink-dim">{p.s.label}</span>
            <span className={cx('ml-auto pl-2 font-semibold tabular', (pt?.status === 'high' || pt?.status === 'flagged') && 'text-high', pt?.status === 'low' && 'text-low', !pt && 'text-ink-faint')}>
              {pt ? `${pt.raw} ${pt.units ?? ''}` : '—'}
              {pt && mode === 'range' ? <span className="font-normal text-ink-faint"> · {rangeWords(pt.nv)}</span> : null}
              {pt && mode === 'z' ? <span className="font-normal text-ink-faint"> · {pt.nv.toFixed(1)} SD</span> : null}
              {pt && mode === 'pct' ? <span className="font-normal text-ink-faint"> · {pt.nv >= 0 ? '+' : ''}{Math.round(pt.nv * 100)}%</span> : null}
              {pt && !exact ? <span className="font-normal text-ink-faint"> ({formatDate(pt.date, 'short')})</span> : null}
            </span>
          </div>
        ))}
      </div>
      {activeEvents.length ? <div className="mt-1.5 border-t border-line pt-1 text-[11.5px] text-ink-dim">{activeEvents.map((e) => e.label).join(' · ')}</div> : null}
    </div>
  )
}

function linePath(pts: PlotPoint[], xOf: (d: number) => number): string {
  return pts.map((x, k) => `${k ? 'L' : 'M'}${xOf(x.day).toFixed(1)},${x.y.toFixed(1)}`).join('')
}

/** Painted zones for range mode: below, within, and multiples above the upper limit. */
function rangeZones(scale: YScale, left: number, w: number, top: number, bottom: number): ReactNode {
  const zones: [number, number, string, number][] = [
    [-99, 0, 'var(--color-low)', 0.1],
    [0, 1, 'var(--color-good)', 0.07],
    [1, 2, 'var(--color-high)', 0.06],
    [2, 3, 'var(--color-high)', 0.11],
    [3, 99, 'var(--color-high)', 0.17],
  ]
  const clampY = (y: number) => Math.max(top - 6, Math.min(bottom, y))
  return (
    <g>
      {zones.map(([a, b, color, op]) => {
        const y0 = clampY(scale.toY(Math.min(b, scale.max)))
        const y1 = clampY(scale.toY(Math.max(a, scale.min)))
        if (y1 - y0 <= 0.5) return null
        return <rect key={`z-${a}`} x={left} y={y0} width={w} height={y1 - y0} fill={color} opacity={op} />
      })}
      {[0, 1].map((t) =>
        t >= scale.min && t <= scale.max ? (
          <line key={`zr-${t}`} x1={left} x2={left + w} y1={scale.toY(t)} y2={scale.toY(t)} stroke={t ? 'var(--color-high)' : 'var(--color-low)'} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        ) : null,
      )}
    </g>
  )
}

function endLabelMarks(plotted: Plotted[], xOf: (d: number) => number, d0: number, d1: number, plotRight: number): ReactNode {
  const items = plotted
    .map((p) => {
      const last = p.pts.filter((x) => x.day >= d0 && x.day <= d1).at(-1)
      return last ? { p, last, y: last.y } : null
    })
    .filter((x): x is { p: Plotted; last: PlotPoint; y: number } => Boolean(x))
    .sort((a, b) => a.y - b.y)
  for (let k = 1; k < items.length; k++) if (items[k].y - items[k - 1].y < 16) items[k].y = items[k - 1].y + 16
  return items.map(({ p, last, y }) => (
    <g key={`el-${p.s.id}`}>
      <line x1={xOf(last.day) + 6} x2={plotRight + 4} y1={last.y} y2={y} stroke={p.s.color} strokeWidth={1} opacity={0.5} />
      <text x={plotRight + 8} y={y + 4} fontSize={12} fontWeight={600} fill="var(--color-ink)">
        {truncate(p.s.label, 12)}
        <tspan fontWeight={400} fill="var(--color-ink-dim)"> {last.raw}</tspan>
      </text>
    </g>
  ))
}

/** Step-wise reference band following each draw's own reported range. */
function refBand(p: Plotted, xOf: (d: number) => number, left: number, right: number, top: number, bottom: number): ReactNode {
  const pts = p.pts
  if (!pts.length) return null
  const out: ReactNode[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    if (a.refLow == null && a.refHigh == null) continue
    const x0 = i === 0 ? left : (xOf(pts[i - 1].day) + xOf(a.day)) / 2
    const x1 = i === pts.length - 1 ? right : (xOf(a.day) + xOf(pts[i + 1].day)) / 2
    const plottable = (v: number | null): v is number => v != null && (!p.scale.log || v > 0)
    const clampY = (y: number) => Math.max(top - 8, Math.min(bottom, y))
    const yHigh = plottable(a.refHigh) ? clampY(p.scale.toY(a.refHigh)) : top - 8
    const yLow = plottable(a.refLow) ? clampY(p.scale.toY(a.refLow)) : bottom
    out.push(<rect key={`rb-${i}`} x={x0} width={Math.max(0, x1 - x0)} y={Math.min(yHigh, yLow)} height={Math.abs(yLow - yHigh)} fill="var(--color-band)" />)
    if (plottable(a.refHigh)) out.push(<line key={`rh-${i}`} x1={x0} x2={x1} y1={yHigh} y2={yHigh} stroke="var(--color-band-line)" strokeWidth={1} strokeDasharray="4 3" />)
    if (plottable(a.refLow) && a.refLow !== 0) out.push(<line key={`rl-${i}`} x1={x0} x2={x1} y1={yLow} y2={yLow} stroke="var(--color-band-line)" strokeWidth={1} strokeDasharray="4 3" />)
  }
  return out
}

/**
 * Reserve space for labels and period bars in the actual viewport. Every period of one event
 * (same name and kind) shares a row and is labelled once, at its first visible period.
 * Compact (phones): no labels, so rows are only needed where periods overlap in time.
 */
function layoutEventLanes(events: TimelineEvent[], d0: number, d1: number, xOf: (day: number) => number, width: number, compact: boolean) {
  const slots = new Map<string, { lane: number; x: number; label: string | null }>()
  if (!width || !events.length) return slots
  const maxChars = Math.max(1, Math.min(28, Math.floor((width - 12) / 11)))
  const groups = new Map<string, TimelineEvent[]>()
  for (const e of events) {
    const key = `${e.kind}\u0000${e.label.trim().toLowerCase()}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const spans = [...groups.values()].map((group) => {
    const periods = group
      .map((e) => {
        const start = xOf(Math.max(d0, dayOf(e.start_date)))
        const end = e.end_date ? xOf(Math.min(d1, dayOf(e.end_date))) : e.ongoing ? xOf(d1) : start
        return { id: e.id, start, end }
      })
      .sort((a, b) => a.start - b.start)
    const first = periods[0]
    const label = compact ? null : truncate(group[0].label, maxChars)
    // Conservative glyph width at the chart's 11px font, including fallback fonts.
    const labelWidth = label ? label.length * 11 : 0
    const x = Math.max(4, Math.min(first.start + (first.end === first.start ? 8 : 0), width - labelWidth - 4))
    const right = Math.max(...periods.map((p) => p.end + 5), x + labelWidth)
    return { periods, firstId: first.id, x, label, left: Math.min(first.start - 5, x), right }
  })
  const ends = compact ? [-Infinity, -Infinity, -Infinity, -Infinity] : [-Infinity, -Infinity, -Infinity]
  for (const span of spans.sort((a, b) => a.left - b.left)) {
    const lane = ends.findIndex((end) => end + 6 < span.left)
    if (lane < 0) continue // The plot still shows every period at full density.
    ends[lane] = span.right
    for (const p of span.periods) slots.set(p.id, { lane, x: span.x, label: p.id === span.firstId ? span.label : null })
  }
  return slots
}

function tickLabel(v: number, mode: ScaleMode): string {
  if (mode === 'range') return v === 0 ? 'low' : v === 1 ? 'upper' : v >= 2 ? `${2 ** (v - 1)}×` : `${Math.round(v * 100)}%`
  if (mode === 'z') return `${v > 0 ? '+' : ''}${formatTick(v)} SD`
  if (mode === 'pct') return `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
  return formatTick(v)
}

function rangeWords(nv: number): string {
  if (nv > 1) return `${(2 ** (nv - 1)).toFixed(1)}× the upper limit`
  if (nv < 0) return 'below the low limit'
  return `${Math.round(nv * 100)}% of the way to the upper limit`
}

function eventDates(e: Pick<TimelineEvent, 'start_date' | 'end_date' | 'ongoing'>): string {
  if (e.end_date && e.end_date !== e.start_date) return `${formatDate(e.start_date)} → ${formatDate(e.end_date)}`
  return e.ongoing ? `${formatDate(e.start_date)} → ongoing` : formatDate(e.start_date)
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, Math.max(3, n - 1))}…` : s
}

const MS_DAY = 86_400_000
function isoOf(day: number): string {
  return new Date(day * MS_DAY).toISOString().slice(0, 10)
}
function dayOf(date: string): number {
  return Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / MS_DAY)
}
