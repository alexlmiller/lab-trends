// Pairwise correlation heatmap. Colour = direction/strength, cells with too
// few paired draws are left empty so sparse pairs don't masquerade as signal.
import { useState } from 'react'
import type { Correlation } from '../../shared/stats'
import { formatR } from '../lib/format'
import { useElementWidth } from './scale'

export type MatrixItem = { id: string; label: string; category: string }

export function CorrMatrix({
  items,
  cell,
  minN,
  selected,
  onSelect,
}: {
  items: MatrixItem[]
  cell: (a: number, b: number) => Correlation | null
  minN: number
  selected: [string, string] | null
  onSelect: (a: string, b: string) => void
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<[number, number] | null>(null)
  const n = items.length
  const labelW = Math.min(150, Math.max(90, width * 0.22))
  const size = Math.max(9, Math.min(26, Math.floor((width - labelW - 8) / Math.max(1, n))))
  const top = Math.min(150, labelW)
  const height = top + size * n + 4
  const hv = hover ? cell(hover[0], hover[1]) : null
  return (
    <div ref={ref} className="relative w-full overflow-x-auto">
      {width ? (
        <svg width={labelW + size * n + 8} height={height} className="block" onPointerLeave={() => setHover(null)}>
          {items.map((it, i) => (
            <g key={`r-${it.id}`}>
              <text x={labelW - 6} y={top + i * size + size / 2 + 4} textAnchor="end" fontSize={Math.min(12, size * 0.7 + 3)} fill={hover?.[0] === i ? 'var(--color-ink)' : 'var(--color-ink-dim)'}>
                {it.label.length > 22 ? `${it.label.slice(0, 21)}…` : it.label}
              </text>
              <text
                transform={`translate(${labelW + i * size + size / 2 + 4} ${top - 6}) rotate(-60)`}
                fontSize={Math.min(12, size * 0.7 + 3)}
                fill={hover?.[1] === i ? 'var(--color-ink)' : 'var(--color-ink-dim)'}
              >
                {it.label.length > 18 ? `${it.label.slice(0, 17)}…` : it.label}
              </text>
            </g>
          ))}
          {items.map((it, i) =>
            i > 0 && it.category !== items[i - 1].category ? (
              <g key={`sep-${i}`}>
                <line x1={labelW - 4} x2={labelW + size * n} y1={top + i * size - 0.5} y2={top + i * size - 0.5} stroke="var(--color-ink-faint)" strokeWidth={1} />
                <line y1={top - 4} y2={top + size * n} x1={labelW + i * size - 0.5} x2={labelW + i * size - 0.5} stroke="var(--color-ink-faint)" strokeWidth={1} />
              </g>
            ) : null,
          )}
          {items.map((a, i) =>
            items.map((b, j) => {
              const x = labelW + j * size
              const y = top + i * size
              if (i === j) return <rect key={`${i}-${j}`} x={x} y={y} width={size - 1} height={size - 1} fill="var(--color-sunken)" />
              const c = cell(i, j)
              const ok = c && c.n >= minN
              const isSel = selected && ((selected[0] === a.id && selected[1] === b.id) || (selected[0] === b.id && selected[1] === a.id))
              return (
                <rect
                  key={`${i}-${j}`}
                  x={x}
                  y={y}
                  width={size - 1}
                  height={size - 1}
                  rx={2}
                  fill={ok ? (c.r >= 0 ? 'var(--color-pos)' : 'var(--color-neg)') : 'var(--color-sunken)'}
                  fillOpacity={ok ? 0.12 + Math.abs(c.r) * 0.88 : 0.6}
                  stroke={isSel ? 'var(--color-ink)' : 'none'}
                  strokeWidth={isSel ? 2 : 0}
                  onPointerEnter={() => setHover([i, j])}
                  onClick={() => onSelect(a.id, b.id)}
                  style={{ cursor: 'pointer' }}
                />
              )
            }),
          )}
        </svg>
      ) : null}
      {hover && hover[0] !== hover[1] ? (
        <div className="pointer-events-none absolute top-2 left-2 rounded-md border border-line-strong bg-surface/95 px-3 py-2 text-[12.5px] shadow-lg">
          <div className="font-semibold">{items[hover[0]].label} × {items[hover[1]].label}</div>
          {hv ? (
            <div className="text-ink-dim">
              r = <b className="text-ink">{formatR(hv.r)}</b> · n = {hv.n}
              {hv.deltaR != null ? <> · changes r = {formatR(hv.deltaR)}</> : null}
              {hv.n < minN ? <div className="text-ink-faint">Fewer than {minN} paired draws</div> : null}
            </div>
          ) : (
            <div className="text-ink-faint">Not enough paired draws</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
