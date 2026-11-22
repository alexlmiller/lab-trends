import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { categoryLabel } from '../../shared/categories'
import { dateFromDay, dayNumber, formatDate, todayDate } from '../../shared/dates'
import { slopePerYear } from '../../shared/stats'
import type { MarkerSeries } from '../../shared/types'
import { OverviewStrip } from '../charts/OverviewStrip'
import { ReadoutBar } from '../charts/ReadoutBar'
import { TimeSeriesChart, type ChartSeries, type ScaleMode } from '../charts/TimeSeriesChart'
import { EventComparison } from '../components/EventComparison'
import { HistoryAnalysis } from '../components/HistoryAnalysis'
import { HistoryViews } from '../components/HistoryViews'
import { Icon } from '../components/Icon'
import { SelectField } from '../components/SelectField'
import { TargetEditor, TestRecord } from '../components/TestRecord'
import { BackLink, Button, ButtonLink, Card, Chip, cx, Disclosure, Empty, linkClass, PageHeader, Segmented, Stat, StatGrid } from '../components/ui'
import { MarkerPicker } from '../components/MarkerPicker'
import { FollowButton, OutOfRange } from '../components/ReportParts'
import { topCorrelates } from '../lib/correlate'
import { useDataset, useListParam, useParam, useUpdateParams } from '../lib/data'
import { formatPct, formatR, formatSigned, plural } from '../lib/format'
import { isOutOfRange, resultStatus, statusTone } from '../../shared/semantics'
import { resultChange } from '../lib/report'
import { numericUnitKey } from '../../shared/units'
import { latestResult, pointsOf, RANGE_OPTIONS, seriesColor, windowFor, type Point } from '../lib/series'
import { drawPath } from '../lib/history'

const VIEW_OPTIONS: { value: ScaleMode; label: string; title: string }[] = [
  { value: 'own', label: 'Lanes', title: 'Each marker in its own units, stacked on one time axis' },
  {
    value: 'range',
    label: 'Normalized',
    title: 'All markers on one chart, placed in each draw’s reported range: low limit, upper limit, then 2× and 4× the upper limit',
  },
  { value: 'z', label: 'Z-score', title: 'Standard deviations from each marker’s mean in this window' },
  { value: 'pct', label: '% change', title: 'Change from the first draw in the window' },
]

function testChoice(m: MarkerSeries) {
  return {
    value: m.id,
    label: m.name,
    detail: m.long_name !== m.name ? (m.long_name ?? undefined) : undefined,
    keywords: [m.slug, categoryLabel(m.category), ...(m.aliases ?? [])].join(' '),
  }
}

export function HistoryPage() {
  const ds = useDataset()
  const [ids] = useListParam('m')
  const [eventId] = useParam('event', '')
  const available = ds.markers.filter((m) => m.results.length)
  const event = ds.events.find((e) => e.id === eventId)
  const related = event?.marker_ids.map((id) => ds.markersById.get(id)).find((m) => m?.results.length)
  const latest = available.filter((m) => latestResult(m)?.draw_date === ds.panels[0]?.draw_date)
  const defaultTest = related ?? latest.find((m) => ds.preferences.starred_marker_ids.includes(m.id)) ?? latest[0] ?? available[0]
  const markers = ids.length
    ? [...new Set(ids)].flatMap((id) => {
        const m = ds.markersById.get(id)
        return m?.results.length ? [m] : []
      })
    : defaultTest
      ? [defaultTest]
      : []
  const primary = markers[0]
  if (!primary)
    return (
      <Empty title={available.length ? 'These tests are unavailable in this record' : 'No lab results yet'}>
        {available.length ? <Link to="/markers">Choose from All tests</Link> : <Link to="/import">Import a report</Link>}
      </Empty>
    )
  return <HistoryDetail key={ds.subjectId + primary.id} markers={markers} />
}

function HistoryDetail({ markers }: { markers: MarkerSeries[] }) {
  const ds = useDataset()
  const navigate = useNavigate()
  const update = useUpdateParams()
  const [marker, ...overlays] = markers
  const selected = markers.map((m) => m.id)
  const overlayIds = selected.slice(1)
  const [eventId] = useParam('event', '')
  const [start] = useParam('period', '')
  const [allEvents] = useParam('events', '1')
  const [linkedPanel] = useParam('panel', '')
  const [inspection] = useParam('inspect', '')
  const defaultRange = linkedPanel || inspection || overlays.length ? 'all' : '3y'
  const [rangeParam] = useParam('range', defaultRange)
  const [win] = useParam('win', '')
  const [layout] = useParam('layout', 'stacked')
  const [scale] = useParam('scale', 'range')
  const [logMode, setLogMode] = useParam('log', 'auto')
  const [showRef, setShowRef] = useParam('ref', '1')
  const [views, setViews] = useState(false)
  const [analysis, setAnalysis] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const available = ds.markers.filter((m) => m.results.length)
  const events = ds.events
  const event = events.find((e) => e.id === eventId)
  const period = event?.periods.find((p) => p.start_date === start) ?? event?.periods.at(-1)
  const relevantEvents = events.filter((e) => !e.marker_ids.length || e.marker_ids.some((id) => selected.includes(id)))
  const all = allEvents === '1' && !eventId && relevantEvents.length > 0
  const shownEvents = event ? [event] : all ? relevantEvents : []
  const panelIds = new Set(markers.flatMap((m) => m.results.map((r) => r.panel_id)))
  const panels = ds.panels.filter((p) => panelIds.has(p.id) || p.id === linkedPanel)
  const range = RANGE_OPTIONS.find((o) => o.value === rangeParam)?.value ?? defaultRange
  const dates = [panels.map((p) => ({ day: dayNumber(p.draw_date) }))]
  const limit = windowFor('all', dates)
  if (event) {
    for (const p of event.periods) {
      limit[0] = Math.min(limit[0], dayNumber(p.start_date) - 2)
      limit[1] = Math.max(limit[1], dayNumber(p.end_date ?? (p.ongoing ? todayDate() : p.start_date)))
    }
  }
  const lastDay = Math.max(dayNumber(todayDate()), dayNumber(panels[0]?.draw_date ?? todayDate()))
  limit[1] = Math.min(limit[1], lastDay)
  const custom = parseWindow(win, lastDay)
  if (custom) {
    limit[0] = Math.min(limit[0], custom[0])
    limit[1] = Math.max(limit[1], custom[1])
  }
  const domain = custom ?? (range === 'all' ? limit : windowFor(range, dates))
  function choose(ids: string[], keepDraw = false) {
    update({ m: [...new Set(ids)].join(','), range, ...(keepDraw ? {} : { inspect: null, panel: null }) })
  }
  const add = (id: string) => {
    if (!selected.includes(id) && selected.length < 8) choose([...selected, id], true)
  }
  function switchPrimary(id: string) {
    if (id === marker.id) return
    const rest = selected.includes(id) ? selected.filter((old) => old !== id) : selected.slice(1)
    choose([id, ...rest], selected.includes(id))
  }
  const remaining = available.filter((m) => !selected.includes(m.id))
  const inView = panels.filter((p) => dayNumber(p.draw_date) >= domain[0] && dayNumber(p.draw_date) <= domain[1])
  const pinned = inView.find((p) => p.id === linkedPanel) ?? inView.find((p) => p.draw_date === inspection) ?? inView[0]
  const pinnedIndex = pinned ? inView.indexOf(pinned) : -1
  const reading =
    hover == null || pinned?.draw_date === dateFromDay(hover)
      ? pinned
      : (inView.find((p) => p.draw_date === dateFromDay(hover)) ?? pinned)
  const selectDraw = (id: string) => {
    const panel = inView.find((p) => p.id === id)
    setHover(null)
    if (panel) update({ inspect: panel.draw_date, panel: panel.id, range })
  }
  const view: ScaleMode = overlays.length && layout === 'overlay' ? (scale === 'z' || scale === 'pct' ? scale : 'range') : 'own'
  const series = markers.map((m, i) => {
    const points = pointsOf(m)
    const mixed = new Set(points.map((p) => numericUnitKey(p.units))).size > 1
    return {
      id: m.id,
      label: m.name,
      color: seriesColor(i),
      units: mixed ? null : (points.at(-1)?.units ?? null),
      // Normalized places each value against its own draw's range, so it doesn't need one unit.
      points: mixed && view !== 'range' ? [] : points,
      mixed,
      target: m.target ? { low: m.target.target_low, high: m.target.target_high } : null,
    }
  })
  const [primary, ...others] = series
  const plottable = series.filter((s) => s.points.length)
  const lanes = view === 'own'
  const setView = (v: ScaleMode) => update({ layout: v === 'own' ? 'stacked' : 'overlay', scale: v === 'own' ? null : v })
  const latest = latestResult(marker)
  const status = statusTone(resultStatus(latest))
  const readings = marker.results.filter((r) => dayNumber(r.draw_date) >= domain[0] && dayNumber(r.draw_date) <= domain[1])
  const exact = primary.points.filter((p) => p.day >= domain[0] && p.day <= domain[1] && !p.censored)
  const slope = slopePerYear(exact)
  const prev = readings.at(-2),
    last = readings.at(-1)
  const change = resultChange(prev, last)
  const pct = change.ratio != null ? formatPct(change.ratio) : null
  const outside = marker.results.filter(isOutOfRange).length
  const refs = [...new Set(marker.results.map((r) => r.reference_text).filter(Boolean))]
  const movers = useMemo(() => {
    const comparable = (m: MarkerSeries) => new Set(pointsOf(m).map((p) => numericUnitKey(p.units))).size === 1
    return comparable(marker)
      ? topCorrelates(marker, ds.markers.filter(comparable), { method: 'spearman', tol: 3, minN: 6, limit: 8 })
      : []
  }, [marker, ds.markers])
  const chartProps = {
    domain,
    log: logMode === 'on' || logMode === 'off' ? logMode : ('auto' as const),
    showRef: showRef === '1',
    events: shownEvents,
    highlightStart: period?.start_date,
    tooltip: false,
    hoverDay: hover ?? (pinned ? dayNumber(pinned.draw_date) : null),
    onHoverDay: setHover,
    onPointClick: (p: Point) => navigate(drawPath(p.panelId)),
  } as const
  const remove = (id: string) =>
    choose(
      selected.filter((s) => s !== id),
      true,
    )
  return (
    <div className="grid gap-5">
      <PageHeader
        back={<BackLink fallback="/markers" fallbackLabel="All tests" />}
        eyebrow={categoryLabel(marker.category)}
        title={marker.long_name || marker.name}
        titleAction={<TestSwitcher value={marker.id} options={available.map(testChoice)} onChange={switchPrimary} />}
        description={[
          marker.long_name && marker.long_name !== marker.name ? marker.name : null,
          latest?.raw_units,
          marker.loinc_code && 'LOINC ' + marker.loinc_code,
          plural(marker.results.length, 'draw'),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <FollowButton markerId={marker.id} size="md" />
            <Button icon="bookmark" onClick={() => setViews(true)}>
              Views
            </Button>
          </>
        }
      />
      <StatGrid className="grid-cols-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] max-sm:[&>:first-child]:col-span-2">
        <Stat label="Latest" sub={formatDate(latest?.draw_date)}>
          <span className={cx('text-[26px] leading-none font-semibold', status === 'high' && 'text-high', status === 'low' && 'text-low')}>{latest?.raw_value ?? '—'}</span>
          <span className="ml-1 text-[12.5px] font-normal text-ink-faint">{latest?.raw_units}</span>
          {latest?.reference_text ? (
            <span className="ml-4 text-[13px] font-normal text-ink-dim">
              Range <span className="font-semibold text-ink">{latest.reference_text}</span>
            </span>
          ) : null}
          {latest && isOutOfRange(latest) ? (
            <span className="ml-2 align-[2px]">
              <OutOfRange result={latest} />
            </span>
          ) : null}
        </Stat>
        <Stat label="Since previous" sub={change.unit && prev ? 'from ' + formatDate(prev.draw_date) : change.note}>
          {withArrow(change.value)} <span className="text-[13px] font-normal text-ink-faint">{change.unit && pct ? pct.replace(/^[+−-]/, '') : null}</span>
        </Stat>
        <Stat label="Trend" sub={slope != null ? [primary.units, 'per year, linear fit'].filter(Boolean).join(' ') : 'Needs 3 comparable draws'}>
          {slope != null ? withArrow(formatSigned(slope)) : '—'}
        </Stat>
      </StatGrid>
      <Card padded={false} className="overflow-visible">
        {/* One wrapping row on desktop; on phones each group is its own row, scale options last. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex items-center gap-2 max-sm:w-full sm:contents">
            <Segmented
              label="Time range"
              value={custom ? '' : range}
              onChange={(v) => update({ range: v, win: null, inspect: null, panel: null })}
              options={RANGE_OPTIONS}
            />
            {custom ? (
              <Chip active onClick={() => update({ win: null })} title="Back to the preset range">
                {formatDate(dateFromDay(custom[0]), 'short')} – {formatDate(dateFromDay(custom[1]), 'short')} <Icon name="x" />
              </Chip>
            ) : null}
            {overlays.length ? (
              <>
                <div className="max-sm:hidden">
                  <Segmented<ScaleMode> label="View" value={view} onChange={setView} options={VIEW_OPTIONS} />
                </div>
                <SelectField label="View" hideLabel size="sm" className="min-w-0 flex-1 sm:hidden" value={view} options={VIEW_OPTIONS} onChange={(v) => setView(v as ScaleMode)} />
              </>
            ) : null}
          </div>
          {lanes ? (
            <div className="flex items-center gap-2 max-sm:order-last max-sm:w-full sm:contents">
              <Segmented
                label="Log scale"
                value={logMode}
                onChange={(v) => setLogMode(v === 'auto' ? '' : v)}
                options={[
                  { value: 'auto', label: 'Auto', title: 'Log scale when values span 20× or more' },
                  { value: 'off', label: 'Linear' },
                  { value: 'on', label: 'Log' },
                ]}
              />
              <Chip active={showRef === '1'} onClick={() => setShowRef(showRef === '1' ? '0' : '')}>
                Reference
              </Chip>
            </div>
          ) : null}
          <div className="flex items-center gap-2 max-sm:w-full sm:contents">
          {events.length > 0 ? (
            <SelectField
              label="Events on chart"
              hideLabel
              size="sm"
              className="min-w-0 max-sm:flex-1 sm:w-48"
              value={event?.id ?? (all ? 'all' : '')}
              options={[
                ...(relevantEvents.length ? [{ value: 'all', label: 'Related events' }] : []),
                { value: '', label: 'No events' },
                ...events.map((e) => ({ value: e.id, label: e.label, detail: e.periods.length > 1 ? plural(e.periods.length, 'period') : undefined })),
              ]}
              onChange={(id) => update({ m: selected.join(','), event: id === 'all' || !id ? null : id, events: id === 'all' ? null : '0', period: null, edge: null })}
            />
          ) : null}
          {remaining.length > 0 && selected.length < 8 ? (
            <div className="min-w-0 max-sm:flex-[1.25] sm:ml-auto sm:w-56">
              <MarkerPicker
                compact
                placeholder="Compare with…"
                options={remaining.map((m) => ({ id: m.id, name: m.name, long_name: m.long_name, category: m.category, aliases: m.aliases, count: m.results.length }))}
                suggestions={{ label: 'Often moves with ' + marker.name, items: movers.filter((x) => !selected.includes(x.marker.id)).map((x) => ({ id: x.marker.id, name: x.marker.name, category: x.marker.category, hint: 'r ' + formatR(x.c.r) })) }}
                onPick={add}
              />
            </div>
          ) : null}
          </div>
        </div>
        <ReadoutBar
          markers={markers}
          panel={reading}
          latest={reading?.id === panels[0]?.id}
          events={shownEvents}
          older={pinnedIndex >= 0 && pinnedIndex < inView.length - 1 ? () => selectDraw(inView[pinnedIndex + 1].id) : undefined}
          newer={pinnedIndex > 0 ? () => selectDraw(inView[pinnedIndex - 1].id) : undefined}
        />
        {series
          .filter((s) => !s.points.length)
          .map((s) => (
            <p key={s.id} className="m-0 border-b border-line px-4 py-2 text-[12.5px] text-ink-dim">
              <strong>{s.label}</strong> · {s.mixed ? 'Reported units vary across draws.' : 'This test has text results.'} Read
              individual values by draw.
            </p>
          ))}
        {view === 'range' && plottable.some((s) => !s.points.some((p) => p.refHigh != null || p.refLow != null)) && (
          <p className="m-0 border-b border-line px-4 py-2 text-[12.5px] text-ink-dim">Tests without a reported range appear in Lanes, Z-score and % change.</p>
        )}
        {lanes ? (
          <div className="grid">
            <div className="px-2 pt-1">
              {primary.points.length > 0 && (
                <TimeSeriesChart
                  {...chartProps}
                  series={[primary]}
                  mode="own"
                  height={overlays.length ? 250 : 300}
                  area
                  endTag
                  showXAxis={!overlays.length}
                />
              )}
            </div>
            {others.map((s, i) => (
              <div key={s.id} className="border-t border-line px-2">
                <LaneHeader series={s} onPrimary={() => switchPrimary(s.id)} onRemove={() => remove(s.id)} />
                {s.points.length > 0 && (
                  <TimeSeriesChart
                    {...chartProps}
                    series={[s]}
                    mode="own"
                    log="auto"
                    height={i === others.length - 1 ? 156 : 128}
                    eventLabels={false}
                    endTag
                    showXAxis={i === others.length - 1}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-2 pt-1">
            <div className="flex flex-wrap gap-1.5 px-1 pt-1.5">
              {others.map((s) => (
                <LaneHeader key={s.id} series={s} compact onPrimary={() => switchPrimary(s.id)} onRemove={() => remove(s.id)} />
              ))}
            </div>
            {plottable.length > 0 && <TimeSeriesChart {...chartProps} series={plottable} mode={view} height={340} endLabels />}
          </div>
        )}

        <div className="border-t border-line px-2 pt-2 pb-1">
          <OverviewStrip
            points={plottable[0]?.points ?? []}
            domain={domain}
            extent={[Math.min(limit[0], domain[0]), lastDay]}
            onChange={([a, b]) => update({ win: dateFromDay(a) + '..' + dateFromDay(b), inspect: null, panel: null })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11.5px] text-ink-faint">
          {lanes && showRef === '1' ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-4 rounded-sm bg-band" /> reference range as reported per draw
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <svg width="10" height="10" aria-hidden>
              <circle cx="5" cy="5" r="4" fill="var(--color-high)" />
            </svg>
            above
            <svg width="10" height="10" aria-hidden>
              <circle cx="5" cy="5" r="4" fill="var(--color-low)" />
            </svg>
            below range
          </span>
          <span className="inline-flex items-center gap-1">
            <svg width="12" height="12" aria-hidden>
              <path d="M1,2L11,2L6,11Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            reported as “&lt;”
          </span>
          {plottable.length > 0 && <span>Drag the window to change the date range · select a point to open its draw</span>}
        </div>
      </Card>
      {event && period && <EventComparison event={event} period={period} markers={markers} />}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Moves with</h2>
          <p className="m-0 mb-3 text-[12.5px] text-ink-dim">
            Tests whose results tend to rise or fall together across draws within three days. “Changes” compares the differences
            between consecutive results.
          </p>
          {movers.length ? (
            <div className="grid">
              {movers.map(({ marker: m, c }) => (
                <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-line py-2 first:border-t-0">
                  <Link to={'/history?' + new URLSearchParams({ m: m.id })} className={cx(linkClass, 'truncate text-[14px]')}>
                    {m.name}
                  </Link>
                  <div className="row-span-2 flex items-center">
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => add(m.id)} disabled={overlayIds.includes(m.id) || selected.length >= 8}>
                      Compare
                    </Button>
                    <ButtonLink size="sm" variant="ghost" icon="scatter" to={'/correlations?' + new URLSearchParams({ a: marker.id, b: m.id })} aria-label={'Scatter plot for ' + m.name} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-[12px] text-ink-faint tabular">
                    <span className={cx('font-semibold', c.r > 0 ? 'text-pos' : 'text-neg')}>r {formatR(c.r)}</span>
                    <span>95% {formatR(c.lo)} to {formatR(c.hi)}</span>
                    <span>n {c.n}</span>
                    <span>changes {formatR(c.deltaR)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-ink-faint">Needs at least 6 draws shared with another marker.</p>
          )}
        </Card>

        <Card>
          <h2 className="m-0 mb-3 text-[15px] font-semibold">Reference &amp; target</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px] tabular">
            <dt className="text-ink-faint">Reported ranges</dt>
            <dd className="m-0">{refs.length ? refs.join(' · ') : '—'}</dd>
            <dt className="text-ink-faint">Outside range</dt>
            <dd className="m-0">{plural(outside, 'draw')}, all time</dd>
            <dt className="text-ink-faint">First draw</dt>
            <dd className="m-0">{formatDate(marker.results[0]?.draw_date)}</dd>
          </dl>
          <TargetEditor marker={marker} />
        </Card>
      </div>

      {marker.description ? (
        <Card>
          <h2 className="m-0 mb-1 text-[15px] font-semibold">About this marker</h2>
          <p className="m-0 text-[13.5px] text-ink-dim">{marker.description}</p>
        </Card>
      ) : null}

      {overlays.length > 0 ? (
        <Disclosure title="Comparison statistics" meta="summary stats and how these tests move together" onToggle={setAnalysis}>
          {analysis ? <HistoryAnalysis markers={markers} domain={domain} /> : null}
        </Disclosure>
      ) : null}
      <TestRecord marker={marker} />
      {views && <HistoryViews ids={selected} onChoose={choose} onClose={() => setViews(false)} />}
    </div>
  )
}

function LaneHeader({
  series,
  onPrimary,
  onRemove,
  compact,
}: {
  series: ChartSeries
  onPrimary: () => void
  onRemove: () => void
  compact?: boolean
}) {
  return (
    <div
      className={cx(
        'flex items-center gap-1.5 text-[12.5px]',
        compact ? 'h-7 rounded-full border border-line px-2.5' : 'px-2 pt-2',
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: series.color }} />
      <button onClick={onPrimary} title="Show this test’s details" className="font-semibold text-ink no-underline hover:underline">
        {series.label}
      </button>
      {!compact ? <span className="text-ink-faint">{series.units}</span> : null}
      <button
        type="button"
        aria-label={`Remove ${series.label}`}
        className={cx('text-ink-faint hover:text-ink', !compact && 'ml-auto')}
        onClick={onRemove}
      >
        <Icon name="x" />
      </button>
    </div>
  )
}

function parseWindow(value: string, lastDay: number): [number, number] | null {
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(value)
  if (!m) return null
  const a = dayNumber(m[1]),
    b = Math.min(lastDay, dayNumber(m[2]))
  return a < b ? [a, b] : null
}

/** "+2.9" → "↑ 2.9", "−4.68" → "↓ 4.68": direction as an arrow rather than a sign. */
function withArrow(value: string): string {
  const v = value.trim()
  if (/^\+/.test(v)) return '↑ ' + v.slice(1)
  if (/^[−-]/.test(v)) return '↓ ' + v.slice(1)
  return /^0(\.0+)?$/.test(v) ? '→ 0' : v
}

/** The page title's chevron: a searchable list of every test, to switch which one History shows. */
function TestSwitcher({ value, options, onChange }: { value: string; options: ReturnType<typeof testChoice>[]; onChange: (id: string) => void }) {
  return (
    <SelectField
      label="Switch test"
      value={value}
      options={options}
      onChange={onChange}
      searchable
      renderTrigger={(props) => (
        <button {...props} title="Switch test" className="grid size-9 shrink-0 place-items-center rounded-md border border-transparent text-ink-faint transition-colors hover:border-line-strong hover:bg-surface hover:text-ink aria-expanded:border-accent aria-expanded:text-ink">
          <Icon name="chevron-down" size={20} />
        </button>
      )}
    />
  )
}
