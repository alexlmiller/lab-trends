// Full-history strip under the main chart, with the visible window as a range
// slider: drag a handle to move that end, drag the window to slide it, tap
// outside it to jump there. The window never extends past today.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { dateFromDay, formatDate } from '../../shared/dates'
import { latestDay, type Point } from '../lib/series'
import { timeTicks, useElementWidth } from './scale'

type Props = {
  points: Point[]
  extent?: [number, number]
  domain: [number, number]
  onChange: (domain: [number, number]) => void
  color?: string
}

type Mode = 'start' | 'end' | 'move'
type Drag = { mode: Mode; grab: number; orig: [number, number]; pointer: string; moved: boolean }

const H = 50
const PAD_X = 48
const MIN_SPAN = 30

export function OverviewStrip({ points, domain, extent, onChange, color = 'var(--color-s1)' }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [preview, setPreview] = useState<[number, number] | null>(null)
  const [hoverMode, setHoverMode] = useState<Mode | 'jump' | null>(null)
  if (points.length < 2) return <div ref={ref} />

  const first = points[0].day
  const last = points.at(-1)!.day
  const hi = extent?.[1] ?? latestDay([points])
  const pad = Math.max(10, Math.round((last - first) * 0.02))
  const lo = extent?.[0] ?? Math.min(first - pad, domain[0])
  const w = Math.max(10, width - PAD_X - 12)
  const xOf = (d: number) => PAD_X + ((d - lo) / (hi - lo || 1)) * w
  const dayAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return lo
    return lo + ((clientX - rect.left - PAD_X) / w) * (hi - lo)
  }
  const clampWindow = ([a, b]: [number, number]): [number, number] => {
    const span = Math.min(b - a, hi - lo)
    const start = Math.max(lo, Math.min(hi - span, a))
    return [Math.round(start), Math.round(start + span)]
  }
  const sel = preview ?? clampWindow([domain[0], Math.min(domain[1], hi)])

  const modeAt = (clientX: number, pointerType: string): Mode | 'jump' => {
    const rect = svgRef.current?.getBoundingClientRect()
    const x = rect ? clientX - rect.left : 0
    const reach = pointerType === 'touch' ? 22 : 10
    const ds = Math.abs(x - xOf(sel[0]))
    const de = Math.abs(x - xOf(sel[1]))
    if (Math.min(ds, de) <= reach) return ds < de ? 'start' : 'end'
    return x > xOf(sel[0]) && x < xOf(sel[1]) ? 'move' : 'jump'
  }

  const resize = (d: Drag, at: number): [number, number] => {
    if (d.mode === 'move') return clampWindow([d.orig[0] + at - d.grab, d.orig[1] + at - d.grab])
    if (d.mode === 'start') return [Math.round(Math.max(lo, Math.min(at, d.orig[1] - MIN_SPAN))), d.orig[1]]
    return [d.orig[0], Math.round(Math.min(hi, Math.max(at, d.orig[0] + MIN_SPAN)))]
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    try {
      svgRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // Capture is an improvement, not a requirement (it throws for synthetic pointers).
    }
    const at = dayAt(e.clientX)
    const mode = modeAt(e.clientX, e.pointerType)
    if (mode === 'jump') {
      // Jump the window so it is centred on the tapped day, then keep sliding it.
      const half = (sel[1] - sel[0]) / 2
      const next = clampWindow([at - half, at + half])
      setPreview(next)
      setDrag({ mode: 'move', grab: at, orig: next, pointer: e.pointerType, moved: true })
      return
    }
    setDrag({ mode, grab: at, orig: sel, pointer: e.pointerType, moved: false })
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return setHoverMode(modeAt(e.clientX, e.pointerType))
    setPreview(resize(drag, dayAt(e.clientX)))
    if (!drag.moved) setDrag({ ...drag, moved: true })
  }
  const finish = () => {
    if (drag?.moved && preview && (preview[0] !== domain[0] || preview[1] !== domain[1])) onChange(preview)
    setDrag(null)
    setPreview(null)
  }
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = Math.max(7, Math.round((sel[1] - sel[0]) / 10)) * (e.key === 'ArrowLeft' ? -1 : 1)
    onChange(clampWindow([sel[0] + step, sel[1] + step]))
  }

  const vals = points.map((p) => p.value)
  const vmin = Math.min(...vals)
  const vmax = Math.max(...vals)
  const yOf = (v: number) => 31 - ((v - vmin) / (vmax - vmin || 1)) * 22
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.day).toFixed(1)},${yOf(p.value).toFixed(1)}`).join('')
  const ticks = width ? thin(timeTicks(lo, hi, w)) : []
  const cursor = drag ? (drag.mode === 'move' ? 'grabbing' : 'ew-resize') : hoverMode === 'move' ? 'grab' : hoverMode === 'jump' ? 'pointer' : 'ew-resize'
  const x0 = xOf(sel[0])
  const x1 = xOf(sel[1])

  return (
    <div ref={ref} className="w-full">
      {width > 0 ? (
        <svg
          ref={svgRef}
          width={width}
          height={H}
          className="block touch-none select-none outline-none focus-visible:[&_.window]:stroke-[var(--color-accent)]"
          style={{ cursor }}
          tabIndex={0}
          role="slider"
          aria-label="Visible time window. Arrow keys move it."
          aria-valuemin={lo}
          aria-valuemax={hi}
          aria-valuenow={sel[0]}
          aria-valuetext={`${formatDate(dateFromDay(sel[0]))} to ${formatDate(dateFromDay(sel[1]))}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={() => {
            setDrag(null)
            setPreview(null)
          }}
          onPointerLeave={() => !drag && setHoverMode(null)}
          onKeyDown={onKeyDown}
        >
          <rect x={PAD_X} y={4} width={w} height={32} rx={4} fill="var(--color-sunken)" />
          <path d={path} fill="none" stroke={color} strokeWidth={1.25} opacity={0.55} />
          {points.map((p) => (
            <circle key={p.resultId} cx={xOf(p.day)} cy={yOf(p.value)} r={1.6} fill={p.status === 'high' ? 'var(--color-high)' : p.status === 'low' ? 'var(--color-low)' : color} />
          ))}
          {/* Dim what is outside the window, outline what is inside. */}
          <rect x={PAD_X} y={4} width={Math.max(0, x0 - PAD_X)} height={32} fill="var(--color-surface)" opacity={0.7} />
          <rect x={x1} y={4} width={Math.max(0, PAD_X + w - x1)} height={32} fill="var(--color-surface)" opacity={0.7} />
          <rect className="window" x={x0} y={3.5} width={Math.max(2, x1 - x0)} height={33} rx={4} fill="none" stroke="var(--color-ink-faint)" strokeWidth={1.25} />
          {[x0, x1].map((x, i) => (
            <g key={i} aria-hidden>
              <rect x={x - 4.5} y={9} width={9} height={22} rx={3} fill="var(--color-surface)" stroke="var(--color-ink-faint)" strokeWidth={1.25} />
              <line x1={x - 1.25} x2={x - 1.25} y1={15} y2={25} stroke="var(--color-ink-faint)" strokeWidth={1} />
              <line x1={x + 1.25} x2={x + 1.25} y1={15} y2={25} stroke="var(--color-ink-faint)" strokeWidth={1} />
            </g>
          ))}
          {ticks.map((t) => (
            <text
              key={t.day}
              x={xOf(t.day)}
              y={H - 2}
              textAnchor="middle"
              fontSize={10}
              fontWeight={t.year ? 650 : 400}
              fill={t.year ? 'var(--color-ink-dim)' : 'var(--color-ink-faint)'}
            >
              {t.label}
            </text>
          ))}
          <text x={PAD_X - 8} y={24} textAnchor="end" fontSize={10} fill="var(--color-ink-faint)">
            All
          </text>
        </svg>
      ) : null}
    </div>
  )
}

/** At most ~8 labels, always keeping year starts. */
function thin<T extends { year: boolean }>(ticks: T[]): T[] {
  if (ticks.length <= 8) return ticks
  const every = Math.ceil(ticks.length / 8)
  return ticks.filter((t, i) => t.year || i % every === 0)
}
