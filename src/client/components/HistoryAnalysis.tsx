import { useMemo } from 'react'
import { Link } from 'react-router'
import { dayNumber, formatDate } from '../../shared/dates'
import { mean, slopePerYear } from '../../shared/stats'
import type { MarkerSeries } from '../../shared/types'
import { correlationFor } from '../lib/correlate'
import { formatNumber, formatR, formatSigned } from '../lib/format'
import { resultChange } from '../lib/report'
import { numericUnitKey } from '../../shared/units'
import { resultStatus } from '../../shared/semantics'
import { pointsOf } from '../lib/series'
import { cx, linkClass } from './ui'

export function HistoryAnalysis({
  markers,
  domain,
}: {
  markers: MarkerSeries[]
  domain: [number, number]
}) {
  const [primary] = markers
  // Each added test against the main one; the Correlations page covers every pair.
  const pairs = useMemo(() => {
    const opts = { method: 'spearman' as const, tol: 3 }
    const comparable = (m: MarkerSeries) => {
      const points = pointsOf(m)
      return points.length > 0 && new Set(points.map((p) => numericUnitKey(p.units))).size === 1
    }
    return markers.slice(1).map((b) => ({ a: primary, b, c: comparable(primary) && comparable(b) ? correlationFor(primary, b, opts) : null }))
  }, [primary, markers])
  return (
    <div className="grid gap-5">
      <div>
      <h3 className="m-0 mb-2 text-[13px] font-semibold text-ink">Statistics in the selected window</h3>
      <div className="grid gap-3">
        {markers.map((m) => {
          const results = m.results.filter((r) => {
            const day = dayNumber(r.draw_date)
            return day >= domain[0] && day <= domain[1]
          })
          const first = results[0],
            last = results.at(-1)
          const change = results.length > 1 ? resultChange(first, last) : undefined
          const points = pointsOf(m).filter((p) => p.day >= domain[0] && p.day <= domain[1] && !p.censored)
          const units = new Set(points.map((p) => numericUnitKey(p.units)))
          const values = units.size === 1 ? points.map((p) => p.value) : []
          const slope = values.length >= 3 ? slopePerYear(points) : null
          const unit = values.length ? points[0].units : null
          const ranged = results.map(resultStatus).filter((status) => status !== 'unknown')
          const reading = (r: typeof last) =>
            r ? [r.raw_value, r.raw_units, '·', formatDate(r.draw_date)].filter(Boolean).join(' ') : '—'
          return (
            <section key={m.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <h4 className="m-0 mb-1.5 text-[13px] font-medium text-ink">{m.name}</h4>
              <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-4 gap-y-2 text-[13px] tabular [&_dd]:m-0 [&_dt]:text-[11.5px] [&_dt]:text-ink-faint">
                <div>
                  <dt>First</dt>
                  <dd>{reading(first)}</dd>
                </div>
                <div>
                  <dt>Latest in view</dt>
                  <dd>{reading(last)}</dd>
                </div>
                <div>
                  <dt>Change</dt>
                  <dd>
                    {change?.value ?? '—'} {change?.unit}
                  </dd>
                </div>
                <div>
                  <dt>Min – max</dt>
                  <dd>
                    {values.length
                      ? formatNumber(Math.min(...values)) + ' – ' + formatNumber(Math.max(...values)) + (unit ? ' ' + unit : '')
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Mean</dt>
                  <dd>{values.length ? [formatNumber(mean(values)), unit].filter(Boolean).join(' ') : '—'}</dd>
                </div>
                <div>
                  <dt>Trend per year</dt>
                  <dd>{slope == null ? '—' : [formatSigned(slope), unit].filter(Boolean).join(' ')}</dd>
                </div>
                <div>
                  <dt>Within range</dt>
                  <dd>{ranged.length ? ranged.filter((s) => s === 'in').length + ' of ' + ranged.length : '—'}</dd>
                </div>
              </dl>
            </section>
          )
        })}
      </div>
      </div>
      <div>
      <h3 className="m-0 mb-1 text-[13px] font-semibold text-ink">{'How these tests move with ' + primary.name}</h3>
      <p className="m-0 mb-2 text-[12.5px] text-ink-dim">
        Spearman correlation uses draws matched within three days, across the full record. The 95% interval shows uncertainty. The
        changes column compares draw-to-draw differences.
      </p>
      {pairs.map(({ a, b, c }) => (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-2 first:border-t-0" key={a.id + ':' + b.id}>
          <Link
            to={
              '/correlations?' +
              new URLSearchParams({ a: a.id, b: b.id, m: [...new Set([...markers.map((m) => m.id), b.id])].join(',') })
            }
            className={linkClass}
          >
            {a.name} × {b.name}
          </Link>
          {c ? (
            <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] tabular [&_dd]:m-0 [&_div]:flex [&_div]:gap-1.5 [&_dt]:text-ink-faint">
              <div>
                <dt>Correlation</dt>
                <dd>{formatR(c.r)}</dd>
              </div>
              <div>
                <dt>95% interval</dt>
                <dd>
                  {formatR(c.lo)} to {formatR(c.hi)}
                </dd>
              </div>
              <div>
                <dt>Paired draws</dt>
                <dd>{c.n}</dd>
              </div>
              <div>
                <dt>Changes</dt>
                <dd>{formatR(c.deltaR)}</dd>
              </div>
            </dl>
          ) : (
            <span className="text-[12.5px] text-ink-faint">Not enough comparable draws</span>
          )}
        </div>
      ))}
      <Link to={'/correlations?' + new URLSearchParams({ m: markers.map((m) => m.id).join(',') })} className={cx(linkClass, 'mt-2 inline-block text-[13px]')}>
        All correlations
      </Link>
      </div>
    </div>
  )
}
