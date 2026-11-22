import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { categoryLabel, sortCategories } from '../../shared/categories'
import { fisherInterval, isConsistent, strengthOf, type Correlation, type Method } from '../../shared/stats'
import type { MarkerSeries } from '../../shared/types'
import { CorrMatrix } from '../charts/CorrMatrix'
import { Scatter } from '../charts/Scatter'
import { TimeSeriesChart } from '../charts/TimeSeriesChart'
import { Alert, Button, Card, Chip, cx, Empty, PageHeader, Segmented } from '../components/ui'
import { correlationFor, pairsFor, supported } from '../lib/correlate'
import { useDataset, useListParam, useParam, useUpdateParams } from '../lib/data'
import { formatR, plural } from '../lib/format'
import { pointsOf, seriesColor, unitsSummary, windowFor } from '../lib/series'
import { CorrBar } from '../charts/CorrBar'

export function CorrelationsPage() {
  const ds = useDataset()
  const [ids, setIds] = useListParam('m')
  const [cat, setCat] = useParam('cat', 'all')
  const [method, setMethod] = useParam('method', 'spearman')
  const [tol, setTol] = useParam('tol', '3')
  const [basis, setBasis] = useParam('basis', 'level')
  const [minN, setMinN] = useParam('min', '6')
  const [a] = useParam('a', '')
  const [b] = useParam('b', '')
  const [log, setLog] = useParam('log', '0')
  const [cross, setCross] = useParam('cross', '0')
  const update = useUpdateParams()
  const selectPair = (x: string, y: string) => update({ a: x, b: y })
  const min = Number(minN)
  const opts = { method: method as Method, tol: Number(tol) }

  const items = useMemo(() => {
    let list = ds.markers.filter((m) => pointsOf(m).length >= Math.max(3, Math.min(min, 4)))
    if (ids.length) list = list.filter((m) => ids.includes(m.id))
    if (cat !== 'all') list = list.filter((m) => m.category === cat)
    const order = sortCategories([...new Set(list.map((m) => m.category))])
    return list.sort((x, y) => order.indexOf(x.category) - order.indexOf(y.category) || x.name.localeCompare(y.name))
  }, [ds.markers, ids, cat, min])

  const matrix = useMemo(() => {
    const n = items.length
    const cells: (Correlation | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null))
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const c = correlationFor(items[i], items[j], opts)
        cells[i][j] = c
        cells[j][i] = c
      }
    return cells
  }, [items, opts.method, opts.tol])

  const top = useMemo(() => {
    const out: { a: MarkerSeries; b: MarkerSeries; c: Correlation; score: number }[] = []
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const c = matrix[i][j]
        if (!c || c.n < min) continue
        if (cross === '1' && items[i].category === items[j].category) continue
        let score: number
        if (basis === 'change') {
          if (c.deltaR == null || c.deltaN < 4) continue
          const [lo, hi] = fisherInterval(c.deltaR, c.deltaN, opts.method)
          score = c.deltaR >= 0 ? Math.max(0, lo) : Math.max(0, -hi)
        } else {
          if (!isConsistent(c)) continue
          score = supported(c)
        }
        if (score > 0) out.push({ a: items[i], b: items[j], c, score })
      }
    return out.sort((x, y) => y.score - x.score).slice(0, 24)
  }, [items, matrix, min, basis, cross, opts.method])
  const linked = (x: MarkerSeries, y: MarkerSeries) => x.related_slugs.includes(y.slug) || y.related_slugs.includes(x.slug)

  const ma = ds.markersById.get(a)
  const mb = ds.markersById.get(b)
  const categories = sortCategories([...new Set(ds.markers.map((m) => m.category))])

  if (ds.markers.length < 2) return <Empty title="Needs at least two tests" />

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Correlations"
        description={<p className="m-0 max-w-3xl">How pairs of tests move together across draws. Pick a cell to see the paired draws. With a handful of draws per test these are leads to look at, not conclusions. Check the interval, the number of draws and the “changes” column before reading much into one.</p>}
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <Segmented
            label="Method"
            value={method}
            onChange={(v) => setMethod(v)}
            options={[
              { value: 'spearman', label: 'Rank (Spearman)', title: 'Robust to outliers and curved relationships' },
              { value: 'pearson', label: 'Linear (Pearson)' },
            ]}
          />
          <Segmented
            label="Colour by"
            value={basis}
            onChange={(v) => setBasis(v)}
            options={[
              { value: 'level', label: 'Levels', title: 'Correlate the values themselves' },
              { value: 'change', label: 'Changes', title: 'Correlate draw-to-draw changes (removes shared long-term drift)' },
            ]}
          />
          <span className="text-[12px] text-ink-faint">Pair draws within</span>
          <Segmented
            label="Pairing window"
            value={tol}
            onChange={(v) => setTol(v)}
            options={[
              { value: '0', label: 'Same day' },
              { value: '3', label: '3 days' },
              { value: '14', label: '2 weeks' },
              { value: '45', label: '6 weeks' },
            ]}
          />
          <span className="text-[12px] text-ink-faint">Min draws</span>
          <Segmented label="Minimum paired draws" value={minN} onChange={(v) => setMinN(v)} options={['4', '6', '8', '10'].map((v) => ({ value: v, label: v }))} />
        </div>
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          <Chip active={cat === 'all' && !ids.length} onClick={() => update({ cat: null, m: null })}>
            All tests
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(cat === c ? 'all' : c)}>
              {categoryLabel(c)}
            </Chip>
          ))}
          <span className="mx-1 self-center text-line-strong">|</span>
          <Chip active={cross === '1'} onClick={() => setCross(cross === '1' ? '0' : '1')} title="Hide pairs from the same panel (e.g. two red-cell indices) to surface relationships across systems">
            Across categories only
          </Chip>
          {ids.length ? (
            <Chip active onClick={() => setIds([])}>
              {plural(ids.length, 'selected test')} ×
            </Chip>
          ) : null}
        </div>
        <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {items.length >= 2 ? (
              <>
                <CorrMatrix
                  items={items.map((m) => ({ id: m.id, label: m.name, category: m.category }))}
                  cell={(i, j) => {
                    const c = matrix[i][j]
                    if (cross === '1' && items[i].category === items[j].category) return null
                    if (!c || basis === 'level') return c
                    return c.deltaR == null ? null : { ...c, r: c.deltaR, n: c.deltaN + 1 }
                  }}
                  minN={min}
                  selected={a && b ? [a, b] : null}
                  onSelect={selectPair}
                />
                <div className="mt-2 flex items-center gap-3 text-[11.5px] text-ink-faint">
                  <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-neg" /> move opposite</span>
                  <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-pos" /> move together</span>
                  <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-sunken" /> fewer than {min} paired draws</span>
                </div>
              </>
            ) : (
              <Empty title="Not enough tests with repeated draws" icon="scatter" />
            )}
          </div>
          <div className="min-w-0">
            {ma && mb ? <PairDetail a={ma} b={mb} opts={opts} log={log === '1'} setLog={(v) => setLog(v ? '1' : '0')} /> : (
              <div className="grid h-full min-h-60 place-items-center rounded-lg border border-dashed border-line-strong text-[13px] text-ink-faint">Select a cell to see the paired draws</div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="m-0 mb-1 text-[15px] font-semibold">Strongest relationships</h2>
        <p className="m-0 mb-2 text-[12.5px] text-ink-dim">
          Pairs with at least {min} paired draws, ranked by how well the draws support the {basis === 'change' ? 'correlation of draw-to-draw changes' : 'correlation of levels'} (the end of the 95% interval nearest zero, so more draws rank higher). With this many pairs some will clear the bar by chance. Pairs marked “linked” are related by definition or physiology (e.g. hemoglobin and hematocrit) and are expected to move together.
        </p>
        {top.length ? (
          <div className="grid gap-0.5">
            {top.map(({ a: x, b: y, c }) => {
              const showChange = basis === 'change' && c.deltaR != null
              const [clo, chi] = showChange ? fisherInterval(c.deltaR!, c.deltaN, opts.method) : [c.lo, c.hi]
              const primary = showChange ? c.deltaR! : c.r
              return (
              <button
                key={`${x.id}-${y.id}`}
                type="button"
                onClick={() => {
                  selectPair(x.id, y.id)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className={cx('flex items-center gap-3 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-sunken', a === x.id && b === y.id && 'bg-accent-tint')}
              >
                <span className="min-w-0 flex-1 truncate">
                  {x.name} <span className="text-ink-faint">×</span> {y.name}
                  {x.category !== y.category ? <span className="ml-1.5 text-[11px] text-ink-faint">{categoryLabel(x.category)} × {categoryLabel(y.category)}</span> : null}
                  {linked(x, y) ? <span className="ml-1.5 rounded bg-sunken px-1 text-[10.5px] text-ink-faint uppercase">linked</span> : null}
                </span>
                <CorrBar r={primary} lo={clo} hi={chi} />
                <span className={cx('w-12 text-right font-semibold tabular', primary > 0 ? 'text-pos' : 'text-neg')}>{formatR(primary)}</span>
                <span className={cx('w-24 text-right text-[12px] tabular', c.deltaR != null && Math.sign(c.deltaR) === Math.sign(c.r) && Math.abs(c.deltaR) >= 0.3 ? 'text-ink' : 'text-ink-faint')}>
                  {showChange ? `levels ${formatR(c.r)}` : `changes ${formatR(c.deltaR)}`}
                </span>
                <span className="w-10 text-right text-[12px] text-ink-faint tabular">n {showChange ? c.deltaN : c.n}</span>
              </button>
              )
            })}
          </div>
        ) : (
          <p className="text-[13px] text-ink-faint">Nothing clears the bar yet. Lower the minimum draws or widen the pairing window.</p>
        )}
      </Card>
    </div>
  )
}

function PairDetail({ a, b, opts, log, setLog }: { a: MarkerSeries; b: MarkerSeries; opts: { method: Method; tol: number }; log: boolean; setLog: (v: boolean) => void }) {
  const navigate = useNavigate()
  const pairs = pairsFor(a, b, opts)
  const c = correlationFor(a, b, { ...opts, log })
  const rawA = new Map(pointsOf(a).map((p) => [p.day, p.raw]))
  const rawB = new Map(pointsOf(b).map((p) => [p.day, p.raw]))
  const la = pointsOf(a).at(-1)
  const lb = pointsOf(b).at(-1)
  const domain = windowFor('all', [pointsOf(a), pointsOf(b)])
  const canLog = pairs.length > 0 && pairs.every((p) => p.a > 0 && p.b > 0)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold">
            <Link to={`/history?m=${a.id}`} className="text-ink">{a.name}</Link> <span className="text-ink-faint">×</span>{' '}
            <Link to={`/history?m=${b.id}`} className="text-ink">{b.name}</Link>
          </div>
          {c ? (
            <div className="text-[13px] text-ink-dim tabular">
              r = <b className={c.r > 0 ? 'text-pos' : 'text-neg'}>{formatR(c.r)}</b> (95% CI {formatR(c.lo)} to {formatR(c.hi)}) · {plural(c.n, 'paired draw')} · {strengthOf(c.r)}
              {c.deltaR != null ? <> · changes r = {formatR(c.deltaR)} ({c.deltaN})</> : null}
            </div>
          ) : (
            <div className="text-[13px] text-ink-faint">Fewer than 3 paired draws</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canLog ? (
            <Segmented label="Axes" value={log ? 'log' : 'linear'} onChange={(v) => setLog(v === 'log')} options={[{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' }]} />
          ) : null}
          <Button size="sm" icon="chart" onClick={() => navigate(`/history?m=${a.id},${b.id}&layout=overlay&scale=z`)}>
            Compare
          </Button>
        </div>
      </div>
      {c && !isConsistent(c) ? <Alert tone="info">The interval includes zero: these draws are consistent with no relationship.</Alert> : null}
      <Scatter
        pairs={pairs}
        log={log}
        x={{ label: a.name, units: unitsSummary(a).units, refLow: la?.refLow, refHigh: la?.refHigh, raw: rawA }}
        y={{ label: b.name, units: unitsSummary(b).units, refLow: lb?.refLow, refHigh: lb?.refHigh, raw: rawB }}
        height={300}
      />
      <div className="rounded-md border border-line">
        <div className="px-2 pt-1.5 text-[11.5px] text-ink-faint">Both over time (z-score)</div>
        <TimeSeriesChart
          series={[
            { id: a.id, label: a.name, color: seriesColor(1), units: unitsSummary(a).units, points: pointsOf(a) },
            { id: b.id, label: b.name, color: seriesColor(2), units: unitsSummary(b).units, points: pointsOf(b) },
          ]}
          domain={domain}
          mode="z"
          height={170}
        />
      </div>
    </div>
  )
}
