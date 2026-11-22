// Followed tests across recent draws. Only out-of-range values carry colour and
// an arrow, so anomalies stand out; select a cell for the same detail the
// Latest results page shows.
import { useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { formatDate } from '../../shared/dates'
import { MarkerPicker } from '../components/MarkerPicker'
import { DrawSwitcher, ResultDetail } from '../components/ReportParts'
import { SelectField } from '../components/SelectField'
import { Icon } from '../components/Icon'
import { Alert, Card, cx, Empty, linkClass, PageHeader, SectionHeader } from '../components/ui'
import { api } from '../lib/api'
import { useDataset, useParam, useUpdateParams } from '../lib/data'
import { PRESETS } from '../lib/presets'
import { relativeToReference } from '../lib/report'

const narrowScreen = window.matchMedia('(max-width: 640px)')
const subscribe = (notify: () => void) => {
  narrowScreen.addEventListener('change', notify)
  return () => narrowScreen.removeEventListener('change', notify)
}

export function WatchlistPage() {
  const ds = useDataset()
  const [through] = useParam('through', '')
  const [group] = useParam('group', 'starred')
  const [test] = useParam('test', '')
  const [draw] = useParam('draw', '')
  const update = useUpdateParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const narrow = useSyncExternalStore(subscribe, () => narrowScreen.matches)
  const starred = ds.preferences.starred_marker_ids
  const available = ds.markers.filter((m) => m.results.length)
  const presets = PRESETS.filter((p) => available.some((m) => p.slugs.includes(m.slug)))
  const preset = presets.find((p) => p.name === group)
  const markers = available.filter((m) => (preset ? preset.slugs.includes(m.slug) : starred.includes(m.id)))
  const start = Math.max(0, ds.panels.findIndex((p) => p.id === through))
  const panels = ds.panels.slice(start, start + (narrow ? 3 : 6))
  const selected = markers.find((m) => m.id === test) ?? markers[0]
  const panel = panels.find((p) => p.id === draw) ?? panels[0]

  async function save(ids: string[]) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.put(`/subjects/${ds.subjectId}/preferences`, { starred_marker_ids: ids })
      await ds.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!ds.panels.length)
    return (
      <>
        <PageHeader title="Watchlist" />
        <Empty title="No lab results yet">
          <Link to="/import" className={linkClass}>
            Import a report
          </Link>{' '}
          to start a watchlist.
        </Empty>
      </>
    )

  return (
    <div>
      <PageHeader
        title="Watchlist"
        description="The tests you follow, across recent draws."
        actions={<DrawSwitcher panels={ds.panels} value={panels[0].id} label="Newest draw shown" onChange={(id) => update({ through: id === ds.panels[0]?.id ? null : id, draw: null })} />}
      />

      <Card className="mb-5 grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Show"
            size="sm"
            className="w-56"
            value={preset?.name ?? 'starred'}
            onChange={(g) => update({ group: g === 'starred' ? null : g, test: null, draw: null })}
            options={[{ value: 'starred', label: 'My watchlist', detail: `${starred.length} followed` }, ...presets.map((p) => ({ value: p.name, label: p.name, detail: 'Preset group' }))]}
          />
          {!preset ? (
            <MarkerPicker compact options={available.filter((m) => !starred.includes(m.id))} onPick={(id) => void save([...starred, id])} placeholder="Watch a test…" />
          ) : null}
        </div>
        {!preset && starred.length ? (
          <div className="flex flex-wrap gap-1.5">
            {available
              .filter((m) => starred.includes(m.id))
              .map((m) => (
                <span key={m.id} className="inline-flex h-7 items-center gap-1 rounded-full border border-line-strong bg-surface pr-1 pl-2.5 text-[13px] text-ink">
                  {m.name}
                  <button type="button" disabled={busy} aria-label={`Stop watching ${m.name}`} onClick={() => void save(starred.filter((id) => id !== m.id))} className="grid size-5 place-items-center rounded-full text-ink-faint hover:bg-sunken hover:text-ink disabled:opacity-50">
                    <Icon name="x" />
                  </button>
                </span>
              ))}
          </div>
        ) : null}
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {markers.length && panel ? (
        <section className="grid gap-4">
          <SectionHeader title={preset?.name ?? 'Watched tests'} meta="newest draw first · select a value for details" />
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[420px] table-fixed border-collapse text-[13px] tabular">
              <caption className="sr-only">Results by draw. Select a value for its comparison and reference range.</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="w-[34%] px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
                    Test
                  </th>
                  {panels.map((p) => (
                    <th key={p.id} scope="col" className="px-2 py-2 text-right font-medium text-ink-dim">
                      <span className="block">{formatDate(p.draw_date, 'short')}</span>
                      <span className="block text-[11px] font-normal text-ink-faint">{p.draw_date.slice(0, 4)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {markers.map((m) => (
                  <tr key={m.id} className="border-b border-line last:border-b-0">
                    <th scope="row" className="truncate px-3 py-1.5 text-left font-medium text-ink">
                      {m.name}
                    </th>
                    {panels.map((p) => {
                      const r = m.results.find((v) => v.panel_id === p.id)
                      const d = r ? relativeToReference(r) : undefined
                      const out = d === 'high' || d === 'low'
                      const isSel = m === selected && p === panel
                      return (
                        <td key={p.id} className="p-0.5">
                          <button
                            type="button"
                            aria-pressed={isSel}
                            aria-label={[m.name, formatDate(p.draw_date), r ? `${r.raw_value} ${r.raw_units ?? ''}` : 'not tested', out ? (d === 'high' ? 'above range' : 'below range') : null].filter(Boolean).join(', ')}
                            onClick={() => update({ test: m.id, draw: p.id }, true)}
                            className={cx(
                              'flex min-h-10 w-full items-center justify-end gap-1 rounded-md px-2 text-right hover:bg-sunken',
                              isSel && 'bg-accent-tint ring-2 ring-accent ring-inset hover:bg-accent-tint',
                              !r && 'text-ink-faint',
                              d === 'high' && 'font-semibold text-high',
                              d === 'low' && 'font-semibold text-low',
                            )}
                          >
                            {out ? <span aria-hidden>{d === 'high' ? '↑' : '↓'}</span> : null}
                            <span className="truncate">{r?.raw_value ?? '—'}</span>
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <ResultDetail marker={selected} panel={panel} result={selected.results.find((r) => r.panel_id === panel.id)} />
            </div>
          ) : null}
        </section>
      ) : (
        <Empty title="Choose the tests you follow" icon="star">
          Watch a test above, or star it in{' '}
          <Link to="/markers" className={linkClass}>
            All tests
          </Link>
          . You can also pick a preset group.
        </Empty>
      )}
    </div>
  )
}
