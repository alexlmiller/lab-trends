// Draw-aligned matrix: markers × draw dates, like a lab-history spreadsheet
// but colour-coded. Good for scanning a whole panel's movement at once.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { categoryLabel, sortCategories } from '../../shared/categories'
import { activeOn } from '../../shared/events'
import { formatDate } from '../../shared/dates'
import { positionInRange } from '../../shared/semantics'
import { mean, stdev } from '../../shared/stats'
import type { MarkerSeries, Result } from '../../shared/types'
import { EVENT_COLORS } from '../charts/TimeSeriesChart'
import { Icon } from '../components/Icon'
import { Chip, cx, Empty, inputClass, PageHeader, Segmented } from '../components/ui'
import { useDataset, useParam } from '../lib/data'
import { formatPct } from '../lib/format'
import { rangeStatus } from '../../shared/semantics'
import { drawPath } from '../lib/history'

type ColorMode = 'range' | 'history' | 'change'

export function GridPage() {
  const ds = useDataset()
  const navigate = useNavigate()
  const [color, setColor] = useParam('color', 'range')
  const [order, setOrder] = useParam('order', 'newest')
  const [query, setQuery] = useParam('q', '')
  const [onlyFlagged, setOnlyFlagged] = useParam('flagged', '0')
  const [category, setCategory] = useParam('cat', 'all')
  const scrollRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLTableRowElement>(null)
  const [headHeight, setHeadHeight] = useState(45)

  const dates = useMemo(() => {
    const set = [...new Set(ds.panels.map((p) => p.draw_date))].sort()
    return order === 'newest' ? set.reverse() : set
  }, [ds.panels, order])
  // The day is shown only to tell apart two draws in the same month.
  const sharedMonths = useMemo(() => {
    const seen = new Set<string>()
    const shared = new Set<string>()
    for (const d of dates) (seen.has(d.slice(0, 7)) ? shared : seen).add(d.slice(0, 7))
    return shared
  }, [dates])
  useLayoutEffect(() => {
    if (headRef.current) setHeadHeight(headRef.current.offsetHeight)
  }, [sharedMonths])
  const panelByDate = useMemo(() => {
    const m = new Map<string, (typeof ds.panels)[number][]>()
    for (const p of ds.panels) m.set(p.draw_date, [...(m.get(p.draw_date) ?? []), p])
    return m
  }, [ds.panels])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = ds.markers.filter((m) => {
      if (category !== 'all' && m.category !== category) return false
      if (onlyFlagged === '1' && !m.results.some((r) => r.lab_flag)) return false
      if (q && ![m.name, m.long_name ?? '', ...(m.aliases ?? [])].some((s) => s.toLowerCase().includes(q))) return false
      return true
    })
    const cats = sortCategories([...new Set(list.map((m) => m.category))], ds.preferences.section_order)
    return cats.map((c) => ({ category: c, markers: list.filter((m) => m.category === c).sort((a, b) => a.name.localeCompare(b.name)) }))
  }, [ds.markers, ds.preferences.section_order, query, category, onlyFlagged])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = order === 'newest' ? 0 : el.scrollWidth
  }, [order, rows.length])

  const categories = sortCategories([...new Set(ds.markers.map((m) => m.category))])
  const chrono = [...dates].sort()
  // Events active on the draw date, or that started since the previous draw.
  const eventsOn = (date: string) => {
    const prev = chrono[chrono.indexOf(date) - 1] ?? '0000-00-00'
    return ds.events.filter((e) => e.periods.some(p => activeOn(p, date) || (p.start_date > prev && p.start_date <= date)))
  }

  if (!ds.markers.length) return <Empty title="No results yet" />

  return (
    <div className="grid gap-3">
      <PageHeader
        title="Timeline"
        description="Every test across every draw. Select a value to open that draw, or a name to open its history."
        actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<ColorMode>
            label="Colour by"
            value={color as ColorMode}
            onChange={(v) => setColor(v)}
            options={[
              { value: 'range', label: 'Vs reference', title: 'Below range = blue, above = orange' },
              { value: 'history', label: 'Vs own history', title: 'Standard deviations from this test’s own mean' },
              { value: 'change', label: 'Change', title: 'Change from the previous draw of the same test' },
            ]}
          />
          <Segmented
            label="Order"
            value={order}
            onChange={(v) => setOrder(v)}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
            ]}
          />
        </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint" />
          <input className={cx(inputClass, 'h-8 pl-8 text-[13px]')} placeholder="Filter tests…" value={query} onChange={(e) => setQuery(e.target.value, true)} />
        </div>
        <Chip active={category === 'all'} onClick={() => setCategory('all')}>
          All
        </Chip>
        {categories.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {categoryLabel(c)}
          </Chip>
        ))}
        <Chip active={onlyFlagged === '1'} onClick={() => setOnlyFlagged(onlyFlagged === '1' ? '0' : '1')}>
          Ever flagged
        </Chip>
        <Legend mode={color as ColorMode} />
      </div>

      <div ref={scrollRef} className="max-h-[calc(100vh-220px)] overflow-auto rounded-lg border border-line bg-surface">
        <table className="border-separate border-spacing-0 text-[12.5px] tabular">
          <thead>
            <tr ref={headRef}>
              <th className="sticky top-0 left-0 z-30 min-w-[190px] border-r border-b border-line bg-elevated px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
                Marker
              </th>
              {dates.map((d) => {
                const panels = panelByDate.get(d) ?? []
                return (
                  <th key={d} className="sticky top-0 z-20 min-w-[76px] border-b border-l border-line bg-elevated px-1.5 py-1.5 text-center font-medium">
                    <button type="button" onClick={() => navigate(drawPath(panels[0]?.id ?? ''))} className="grid w-full text-ink hover:text-accent" title={formatDate(d)}>
                      <span className="text-[13px] font-semibold whitespace-nowrap">{monthYear(d)}</span>
                      {sharedMonths.has(d.slice(0, 7)) && <span className="text-[11px] font-normal text-ink-faint">{ordinal(Number(d.slice(8, 10)))}</span>}
                    </button>
                  </th>
                )
              })}
            </tr>
            {ds.events.length ? (
              <tr>
                <th style={{ top: headHeight }} className="sticky left-0 z-30 border-r border-b border-line bg-elevated px-3 py-1 text-left text-[11px] font-normal text-ink-faint" title="Events active at the draw, or started since the previous draw">Events since last draw</th>
                {dates.map((d) => {
                  const evs = eventsOn(d)
                  return (
                    <td key={d} style={{ top: headHeight }} className="sticky z-20 border-b border-l border-line bg-elevated px-1 py-1" title={evs.map((e) => e.label).join('\n')}>
                      <div className="flex flex-col gap-0.5">
                        {evs.slice(0, 3).map((e) => (
                          <span key={e.id} className="truncate rounded-sm px-1 text-[10px] leading-[14px] font-semibold text-white" style={{ background: EVENT_COLORS[e.kind] ?? EVENT_COLORS.other, maxWidth: 66 }}>
                            {e.label}
                          </span>
                        ))}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ) : null}
            {ds.panels.some((p) => p.tags.length) ? (
              <tr>
                <th className="sticky left-0 z-10 border-r border-b border-line bg-surface px-3 py-1 text-left text-[11px] font-normal text-ink-faint">Draw context</th>
                {dates.map((d) => (
                  <td key={d} className="border-b border-l border-line px-1 py-1 text-center text-[10.5px] text-ink-dim">
                    {[...new Set((panelByDate.get(d) ?? []).flatMap((p) => p.tags))].join(', ')}
                  </td>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {rows.map((g) => (
              <GroupRows key={g.category} label={categoryLabel(g.category)} markers={g.markers} dates={dates} mode={color as ColorMode} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  return n + (teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
}

function monthYear(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
}

function GroupRows({ label, markers, dates, mode }: { label: string; markers: MarkerSeries[]; dates: string[]; mode: ColorMode }) {
  return (
    <>
      <tr>
        <td className="sticky left-0 z-10 border-b border-line bg-sunken px-3 py-1 text-[11px] font-semibold tracking-[0.06em] text-ink-dim uppercase">{label}</td>
        <td colSpan={dates.length} className="border-b border-line bg-sunken" />
      </tr>
      {markers.map((m) => (
        <MarkerRow key={m.id} marker={m} dates={dates} mode={mode} />
      ))}
    </>
  )
}

function MarkerRow({ marker, dates, mode }: { marker: MarkerSeries; dates: string[]; mode: ColorMode }) {
  const byDate = useMemo(() => {
    const m = new Map<string, Result>()
    for (const r of marker.results) if (!m.has(r.draw_date)) m.set(r.draw_date, r)
    return m
  }, [marker.results])
  const stats = useMemo(() => {
    const vals = marker.results.map((r) => r.value_numeric).filter((v): v is number => v != null)
    return { mean: mean(vals), sd: stdev(vals) }
  }, [marker.results])
  const prevOf = useMemo(() => {
    const sorted = [...marker.results].sort((a, b) => a.draw_date.localeCompare(b.draw_date))
    const map = new Map<string, Result | null>()
    sorted.forEach((r, i) => map.set(r.draw_date, i ? sorted[i - 1] : null))
    return map
  }, [marker.results])
  const units = marker.results.at(-1)?.raw_units ?? marker.default_units
  return (
    <tr className="group">
      <th className="sticky left-0 z-10 max-w-[220px] border-r border-b border-line bg-surface px-3 py-1 text-left font-normal group-hover:bg-elevated">
        <Link to={`/history?m=${marker.id}`} className="block truncate font-medium text-ink no-underline hover:text-accent">
          {marker.name}
        </Link>
        <div className="truncate text-[11px] text-ink-faint">{units}</div>
      </th>
      {dates.map((d) => {
        const r = byDate.get(d)
        if (!r) return <td key={d} className="border-b border-l border-line group-hover:bg-elevated/60" />
        const { bg, title } = cellStyle(r, mode, stats, prevOf.get(d) ?? null)
        return (
          <td key={d} className="border-b border-l border-line p-0" style={{ background: bg }}>
            <Link
              to={drawPath(r.panel_id, r.id)}
              title={`${marker.name} ${r.raw_value} ${r.raw_units ?? ''}${r.reference_text ? ` (ref ${r.reference_text})` : ''}\n${title}`}
              className={cx('block px-1.5 py-1.5 text-center text-ink no-underline hover:outline hover:outline-1 hover:outline-ink-faint', r.lab_flag && 'font-semibold')}
            >
              {r.raw_value.length > 8 ? `${r.raw_value.slice(0, 7)}…` : r.raw_value}
            </Link>
          </td>
        )
      })}
    </tr>
  )
}

function cellStyle(r: Result, mode: ColorMode, stats: { mean: number; sd: number }, prev: Result | null): { bg: string | undefined; title: string } {
  const v = r.value_numeric
  if (mode === 'range') {
    const st = rangeStatus(v, r.ref_low, r.ref_high, r.lab_flag)
    if (st === 'unknown') return { bg: undefined, title: 'No reference range reported' }
    if (st === 'in') return { bg: undefined, title: 'Within reference range' }
    const pos = v != null ? positionInRange(v, r.ref_low, r.ref_high) : null
    const far = pos == null ? 0.5 : st === 'high' ? Math.min(1, (pos - 1) / 0.5) : Math.min(1, -pos / 0.5)
    const pct = Math.round(14 + far * 26)
    return { bg: `color-mix(in srgb, var(--color-${st}) ${pct}%, transparent)`, title: st === 'high' ? 'Above range' : 'Below range' }
  }
  if (v == null) return { bg: undefined, title: '' }
  if (mode === 'history') {
    if (!(stats.sd > 0)) return { bg: undefined, title: '' }
    const z = (v - stats.mean) / stats.sd
    const pct = Math.round(Math.min(1, Math.abs(z) / 2.5) * 40)
    return { bg: pct < 4 ? undefined : `color-mix(in srgb, var(--color-${z > 0 ? 'pos' : 'neg'}) ${pct}%, transparent)`, title: `${z >= 0 ? '+' : ''}${z.toFixed(1)} SD vs own mean` }
  }
  if (!prev || prev.value_numeric == null || prev.value_numeric === 0) return { bg: undefined, title: 'First draw' }
  const change = v / prev.value_numeric - 1
  const pct = Math.round(Math.min(1, Math.abs(change) / 0.5) * 40)
  return { bg: pct < 4 ? undefined : `color-mix(in srgb, var(--color-${change > 0 ? 'pos' : 'neg'}) ${pct}%, transparent)`, title: `${formatPct(change)} vs ${formatDate(prev.draw_date)}` }
}

function Legend({ mode }: { mode: ColorMode }) {
  const swatch = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1">
      <span className="h-3 w-3 rounded-sm" style={{ background: `color-mix(in srgb, var(${color}) 35%, transparent)` }} />
      {label}
    </span>
  )
  return (
    <div className="ml-auto flex items-center gap-3 text-[12px] text-ink-dim">
      {mode === 'range' ? (
        <>
          {swatch('--color-low', 'Below range')}
          {swatch('--color-high', 'Above range')}
        </>
      ) : mode === 'history' ? (
        <>
          {swatch('--color-neg', 'Below own mean')}
          {swatch('--color-pos', 'Above own mean')}
        </>
      ) : (
        <>
          {swatch('--color-neg', 'Fell')}
          {swatch('--color-pos', 'Rose')}
        </>
      )}
    </div>
  )
}
