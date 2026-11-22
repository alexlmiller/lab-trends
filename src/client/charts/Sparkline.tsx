// Time-spaced sparkline with the latest reference band. Points are placed by
// date, not index, so long gaps read as gaps.
import { useMemo } from 'react'
import { statusColor, type Point } from '../lib/series'

export function Sparkline({ points, domain, width = 132, height = 36, color = 'var(--color-s1)' }: { points: Point[]; domain: [number, number]; width?: number; height?: number; color?: string }) {
  const geo = useMemo(() => {
    const pts = points.filter((p) => p.day >= domain[0] && p.day <= domain[1])
    if (!pts.length) return null
    const last = pts[pts.length - 1]
    const vals = pts.map((p) => p.value)
    const refs = [last.refLow, last.refHigh].filter((v): v is number => v != null)
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    // Include the band only when it is within ~1 data-span of the values.
    const span = max - min || Math.abs(max) * 0.2 || 1
    for (const r of refs) if (r > min - span && r < max + span) {
      min = Math.min(min, r)
      max = Math.max(max, r)
    }
    const pad = (max - min || 1) * 0.12
    min -= pad
    max += pad
    const x = (d: number) => 3 + ((d - domain[0]) / (domain[1] - domain[0] || 1)) * (width - 6)
    const y = (v: number) => height - 3 - ((v - min) / (max - min)) * (height - 6)
    return { pts, last, x, y, refLow: last.refLow, refHigh: last.refHigh, min, max }
  }, [points, domain, width, height])
  if (!geo) return <svg width={width} height={height} aria-hidden />
  const { pts, last, x, y } = geo
  const bandTop = geo.refHigh != null ? Math.max(0, y(geo.refHigh)) : 0
  const bandBottom = geo.refLow != null ? Math.min(height, y(geo.refLow)) : height
  const lastColor = statusColor(last.status) ?? color
  return (
    <svg width={width} height={height} aria-hidden className="block overflow-visible">
      {geo.refLow != null || geo.refHigh != null ? <rect x={0} width={width} y={bandTop} height={Math.max(0, bandBottom - bandTop)} fill="var(--color-band)" opacity={0.55} rx={2} /> : null}
      {pts.length > 1 ? (
        <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join('')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.85} />
      ) : null}
      {pts.map((p) =>
        statusColor(p.status) ? (
          <circle key={p.resultId} cx={x(p.day)} cy={y(p.value)} r={1.8} fill={statusColor(p.status)!} />
        ) : null,
      )}
      <circle cx={x(last.day)} cy={y(last.value)} r={3} fill={lastColor} stroke="var(--color-surface)" strokeWidth={1.25} />
    </svg>
  )
}
