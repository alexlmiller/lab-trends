import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { categoryLabel, sortCategories } from '../../shared/categories'
import { dayNumber, formatDate, MONTHS, todayDate } from '../../shared/dates'
import type { MarkerSeries } from '../../shared/types'
import { Sparkline } from '../charts/Sparkline'
import { Icon } from '../components/Icon'
import { Button, cx, Empty, inputClass, linkClass, PageHeader, Segmented } from '../components/ui'
import { useDataset, useParam, useSavePreferences } from '../lib/data'
import { formatPct, plural } from '../lib/format'
import { PRESETS } from '../lib/presets'
import { isOutOfRange, resultStatus, statusTone } from '../../shared/semantics'
import { latestResult, pointsOf, STATUS_PHRASE, unitsSummary } from '../lib/series'

type Filter = 'all' | 'out' | 'flagged' | 'starred' | 'recent'

export function OverviewPage() {
  const ds = useDataset()
  const navigate = useNavigate()
  const [query, setQuery] = useParam('q', '')
  const [filter, setFilter] = useParam('filter', 'all')
  const [selected, setSelected] = useState<string[]>([])
  const savePreferences = useSavePreferences()
  // One set for as long as the list is the same, so the filtering and grouping below are not redone on every render.
  const starred = useMemo(() => new Set(ds.preferences.starred_marker_ids), [ds.preferences.starred_marker_ids])

  // One time axis for every sparkline, so co-movement lines up vertically.
  const domain = useMemo<[number, number]>(() => {
    const days = ds.markers.flatMap((m) => pointsOf(m).map((p) => p.day))
    const end = Math.max(...days, dayNumber(todayDate()) - 30)
    const start = Math.min(...days, end - 365)
    return [start - 20, end + 20]
  }, [ds.markers])

  const yearAgo = dayNumber(todayDate()) - 365
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ds.markers.filter((m) => {
      if (q && ![m.name, m.long_name ?? '', categoryLabel(m.category), ...(m.aliases ?? [])].some((s) => s.toLowerCase().includes(q))) return false
      const latest = latestResult(m)
      if (filter === 'out' && !(latest && isOutOfRange(latest))) return false
      if (filter === 'flagged' && !m.results.some((r) => r.lab_flag)) return false
      if (filter === 'starred' && !starred.has(m.id)) return false
      if (filter === 'recent' && (!latest || dayNumber(latest.draw_date) < yearAgo)) return false
      return true
    })
  }, [ds.markers, query, filter, starred, yearAgo])

  const groups = useMemo(() => {
    const by = new Map<string, MarkerSeries[]>()
    for (const m of visible) by.set(m.category, [...(by.get(m.category) ?? []), m])
    return sortCategories([...by.keys()]).map((c) => ({
      category: c,
      markers: by.get(c)!.sort((a, b) => Number(starred.has(b.id)) - Number(starred.has(a.id)) || a.name.localeCompare(b.name)),
    }))
  }, [visible, starred])

  const outNow = ds.markers.filter((m) => statusTone(resultStatus(latestResult(m)))).length
  const toggleStar = (id: string) => savePreferences({ starred_marker_ids: starred.has(id) ? [...starred].filter((x) => x !== id) : [...starred, id] })
  const bySlug = new Map(ds.markers.map((m) => [m.slug, m]))
  const presets = PRESETS.map((p) => ({ ...p, ids: p.slugs.map((s) => bySlug.get(s)?.id).filter((x): x is string => Boolean(x)) })).filter((p) => p.ids.length >= 2)

  if (!ds.markers.length) {
    return (
      <Empty title="No lab results yet" icon="upload">
        Import PDFs, photos or spreadsheets of lab reports. Each file is read into a reviewable draft before anything is saved.
        <div className="mt-3 flex justify-center gap-2">
          <Button variant="primary" icon="upload" onClick={() => navigate('/import')}>
            Import results
          </Button>
        </div>
      </Empty>
    )
  }

  return (
    <div className="grid gap-4">
      <section>
        <PageHeader
          title="All tests"
          description={
            <span className="tabular">
              Last draw{' '}
              <Link to="/" className={linkClass}>
                {formatDate(ds.panels[0]?.draw_date)}
              </Link>{' '}
              · {plural(ds.panels.length, 'draw')} since {formatDate(ds.panels.at(-1)?.draw_date, 'month')}
              {outNow ? (
                <>
                  {' '}
                  ·{' '}
                  <button type="button" className="font-medium text-high hover:underline" onClick={() => setFilter('out')}>
                    {outNow} outside range at last measurement
                  </button>
                </>
              ) : null}
            </span>
          }
        />
        <div className="-mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
          <span className="text-ink-faint">Compare</span>
          {presets.map((p) => (
            <Link key={p.name} to={`/history?m=${p.ids.join(',')}`} className="text-ink-dim no-underline hover:text-accent hover:underline">
              {p.name}
            </Link>
          ))}
          {ds.saved_views.map((v) => (
            <Link key={v.id} to={v.path} className="inline-flex items-center gap-1 text-ink-dim no-underline hover:text-accent hover:underline">
              <Icon name="bookmark" /> {v.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint" />
          <input className={cx(inputClass, 'h-8 pl-8 text-[13px]')} placeholder="Search tests…" value={query} onChange={(e) => setQuery(e.target.value, true)} />
        </div>
        <Segmented<Filter>
          label="Filter"
          value={filter as Filter}
          onChange={(v) => setFilter(v)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'out', label: 'Out of range' },
            { value: 'recent', label: 'Last 12 months' },
            { value: 'flagged', label: 'Ever flagged' },
            { value: 'starred', label: 'Starred' },
          ]}
        />
      </section>

      {groups.length ? (
        <div className="gap-6 xl:columns-2">
          {groups.map((g) => (
            <section key={g.category} className="mb-5 break-inside-avoid">
              <h2 className="mb-1 flex items-baseline gap-2 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-dim uppercase">
                {categoryLabel(g.category)} <span className="font-normal text-ink-faint">{g.markers.length}</span>
              </h2>
              <div className="overflow-hidden rounded-lg border border-line bg-surface">
                {g.markers.map((m) => (
                  <MarkerRow
                    key={m.id}
                    marker={m}
                    domain={domain}
                    starred={starred.has(m.id)}
                    selected={selected.includes(m.id)}
                    onToggleSelect={() => setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                    onToggleStar={() => void toggleStar(m.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="No tests match" icon="search" />
      )}

      {selected.length ? (
        <div className="fixed inset-x-0 bottom-4 z-30 max-lg:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] mx-auto flex w-max max-w-[calc(100vw-32px)] items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 shadow-xl">
          <span className="text-[13px] text-ink-dim">{plural(selected.length, 'test')} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
          <Button size="sm" onClick={() => navigate(`/correlations?m=${selected.join(',')}`)} disabled={selected.length < 2} icon="scatter">
            Correlate
          </Button>
          <Button size="sm" variant="primary" onClick={() => navigate(`/history?m=${selected.join(',')}`)} icon="chart">
            Compare
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function MarkerRow({
  marker,
  domain,
  starred,
  selected,
  onToggleSelect,
  onToggleStar,
}: {
  marker: MarkerSeries
  domain: [number, number]
  starred: boolean
  selected: boolean
  onToggleSelect: () => void
  onToggleStar: () => void
}) {
  const latest = latestResult(marker)
  const status = resultStatus(latest)
  const tone = statusTone(status)
  const pts = pointsOf(marker)
  const last = pts.at(-1)
  const prev = pts.length > 1 ? pts[pts.length - 2] : null
  const delta = last && prev && prev.value !== 0 ? last.value / prev.value - 1 : null
  const units = latest?.raw_units ?? unitsSummary(marker).units ?? ''
  const date = latest?.draw_date
  const title = [marker.long_name && marker.long_name !== marker.name ? marker.long_name : null, latest?.reference_text ? `ref ${latest.reference_text}` : null, plural(marker.results.length, 'draw')]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      className={cx(
        'group relative grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2 border-b border-line px-2 py-1.5 last:border-b-0 hover:bg-elevated sm:grid-cols-[18px_minmax(0,1fr)_112px_92px_48px_48px]',
        selected && 'bg-accent-tint hover:bg-accent-tint',
      )}
    >
      <button
        type="button"
        onClick={onToggleStar}
        aria-label={starred ? `Unstar ${marker.name}` : `Star ${marker.name}`}
        className={cx('relative z-10 grid h-[18px] w-[18px] place-items-center rounded', starred ? 'text-warn' : 'text-ink-faint opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-40')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
        </svg>
      </button>
      <Link to={`/history?m=${marker.id}`} title={title} className="min-w-0 truncate text-[13.5px] font-medium text-ink no-underline after:absolute after:inset-0 after:content-['']">
        {marker.name}
      </Link>
      <div className="hidden sm:block">
        <Sparkline points={pts} domain={domain} width={112} height={24} />
      </div>
      <div className="flex items-baseline justify-end gap-1 text-right tabular">
        <span className={cx('text-[14px] font-semibold', tone === 'high' && 'text-high', tone === 'low' && 'text-low')}>{latest?.raw_value ?? '—'}</span>
        {tone ? (
          <span className={cx('text-[10px] font-bold', tone === 'high' ? 'text-high' : 'text-low')} title={STATUS_PHRASE[status]}>
            {status === 'high' ? 'H' : status === 'low' ? 'L' : '!'}
          </span>
        ) : null}
        <span className="max-w-[56px] truncate text-[11px] text-ink-faint">{units}</span>
      </div>
      <span className="hidden text-right text-[11.5px] text-ink-faint tabular sm:block" title={prev ? `vs ${formatDate(prev.date)}` : undefined}>
        {delta != null ? `${delta > 0 ? '↑' : delta < 0 ? '↓' : '→'}${formatPct(Math.abs(delta), false)}` : ''}
      </span>
      <span className="hidden text-right text-[11.5px] text-ink-faint tabular sm:block" title={formatDate(date)}>
        {date ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ’${date.slice(2, 4)}` : ''}
      </span>
      <label
        className={cx(
          'absolute top-1/2 right-1 z-10 grid -translate-y-1/2 cursor-pointer place-items-center rounded bg-surface p-1 shadow-sm',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
        )}
        title="Select to compare"
      >
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-3.5 w-3.5 accent-[var(--color-accent)]" aria-label={`Select ${marker.name}`} />
      </label>
    </div>
  )
}
