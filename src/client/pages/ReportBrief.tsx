// Home: one draw at a glance, each result with its range viewer; tap a row for
// the comparison with the previous result. Grouped by result (watched tests
// first, then out of range, in range, no range) or by test type. Watched tests
// carry a star; those missing from this draw show their last measurement.
import type React from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatDate } from '../../shared/dates'
import type { MarkerSeries, Result } from '../../shared/types'
import { categoryLabel, categoryOrder } from '../../shared/categories'
import { isOutOfRange, resultStatus } from '../../shared/semantics'
import { DrawSwitcher, ResultRow, SourceReports } from '../components/ReportParts'
import { Icon } from '../components/Icon'
import { ResultEditModal } from '../components/ResultEdit'
import { Alert, Button, ButtonLink, Empty, Modal, PageHeader, SectionHeader, Segmented, Stat, StatGrid } from '../components/ui'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { PanelEditModal } from './Draws'
import { useDataset, useParam, useUpdateParams } from '../lib/data'
import { plural } from '../lib/format'
import { priorResult } from '../lib/report'

type Row = { marker: MarkerSeries; result: Result }

export function ReportBriefPage() {
  const ds = useDataset()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Row | null>(null)
  const [editDraw, setEditDraw] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const remove = useAction()
  const [draw] = useParam('draw', '')
  const [selected] = useParam('result', '')
  const [groupParam] = useParam('group', 'status')
  const update = useUpdateParams()
  const panel = ds.panels.find((p) => p.id === draw) ?? ds.panels[0]
  if (!panel)
    return (
      <>
        <PageHeader title="Latest results" actions={<ButtonLink to="/import" variant="primary" icon="plus">Add results</ButtonLink>} />
        <Empty title="Your first lab report">Import a lab report to see its results here, each against its reported range.</Empty>
      </>
    )

  const rows: Row[] = []
  const watched: Row[] = []
  const stars = new Set(ds.preferences.starred_marker_ids)
  for (const marker of ds.markers) {
    const result = marker.results.find((r) => r.panel_id === panel.id)
    if (result) rows.push({ marker, result })
    else if (stars.has(marker.id)) {
      const last = priorResult(marker, panel)
      if (last) watched.push({ marker, result: last })
    }
  }
  const byName = (a: Row, b: Row) => a.marker.name.localeCompare(b.marker.name)
  const severity = (r: Result) => (r.lab_flag === 'critical' ? 0 : 1)
  const out = rows.filter((r) => isOutOfRange(r.result)).sort((a, b) => severity(a.result) - severity(b.result) || byName(a, b))
  const inRange = rows.filter((r) => resultStatus(r.result) === 'in').sort(byName)
  const other = rows.filter((r) => resultStatus(r.result) === 'unknown').sort(byName)
  const high = out.filter((r) => resultStatus(r.result) === 'high').length
  const low = out.filter((r) => resultStatus(r.result) === 'low').length
  const firstTime = rows.filter(({ marker }) => !priorResult(marker, panel)).length
  const i = ds.panels.indexOf(panel)
  const previousDraw = ds.panels[i + 1]
  const isLatest = i === 0

  const groupBy = groupParam === 'type' ? 'type' : 'status'
  const isStarred = (r: Row) => stars.has(r.marker.id)
  const outFirst = (a: Row, b: Row) => Number(isOutOfRange(b.result)) - Number(isOutOfRange(a.result)) || byName(a, b)
  const watchAction = <ButtonLink to="/watchlist" size="sm" variant="ghost" icon="star">Watchlist</ButtonLink>
  type Section = { key: string; title: string; meta: string; items: Row[]; actions?: React.ReactNode }
  const sections: Section[] = []
  if (groupBy === 'status') {
    const here = rows.filter(isStarred).sort(outFirst)
    if (here.length || watched.length)
      sections.push({
        key: 'watch',
        title: 'Watchlist',
        meta: [here.length && `${here.length} on this report`, watched.length && `${watched.length} measured earlier`].filter(Boolean).join(' · '),
        items: [...here, ...watched.sort(byName)],
        actions: watchAction,
      })
    const rest = (items: Row[]) => items.filter((r) => !isStarred(r))
    sections.push(
      { key: 'out', title: 'Out of range', meta: '', items: rest(out) },
      { key: 'in', title: 'In range', meta: '', items: rest(inRange) },
      { key: 'none', title: 'No reported range', meta: '', items: rest(other) },
    )
  } else {
    const byCategory = new Map<string, Row[]>()
    for (const r of rows) byCategory.set(r.marker.category, [...(byCategory.get(r.marker.category) ?? []), r])
    for (const [category, items] of [...byCategory].sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]) || categoryLabel(a[0]).localeCompare(categoryLabel(b[0])))) {
      const flagged = items.filter((r) => isOutOfRange(r.result)).length
      sections.push({ key: category, title: categoryLabel(category), meta: [plural(items.length, 'result'), flagged && `${flagged} out of range`].filter(Boolean).join(' · '), items: items.sort(byName) })
    }
    if (watched.length) sections.push({ key: 'watch', title: 'Watched tests not on this report', meta: 'last measured earlier', items: watched.sort(byName), actions: watchAction })
  }

  const list = (items: Row[]) => (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      {items.map(({ marker, result }) => (
        <ResultRow
          key={result.id}
          marker={marker}
          result={result}
          starred={stars.has(marker.id)}
          showDate={result.panel_id !== panel.id}
          open={selected === result.id}
          onToggle={() => update({ result: selected === result.id ? null : result.id }, true)}
          onEdit={() => setEditing({ marker, result })}
        />
      ))}
    </div>
  )

  return (
    <div>
      <PageHeader
        eyebrow={isLatest ? 'Latest report' : 'Earlier report'}
        title={
          <>
            {formatDate(panel.draw_date)}
            {panel.draw_time ? <span className="ml-2 font-sans text-[16px] font-normal tracking-normal text-ink-faint">{panel.draw_time}</span> : null}
          </>
        }
        description={[panel.panel_name && panel.panel_name !== panel.facility ? panel.panel_name : null, panel.facility, panel.ordering_provider && `ordered by ${panel.ordering_provider}`, plural(rows.length, 'test')].filter(Boolean).join(' · ')}
        actions={
          <>
            <DrawSwitcher panels={ds.panels} value={panel.id} onChange={(id) => update({ draw: id === ds.panels[0]?.id ? null : id, result: null })} />
            <ButtonLink to="/import" variant="primary" icon="plus" aria-label="Add results">
              <span className="max-sm:hidden">Add results</span>
            </ButtonLink>
          </>
        }
      />

      {panel.tags.length || panel.notes ? (
        <div className="-mt-3 mb-5 grid gap-1.5">
          {panel.tags.length ? (
            <div className="flex flex-wrap gap-1">
              {panel.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[12px] text-ink-dim">
                  <Icon name="tag" /> {t}
                </span>
              ))}
            </div>
          ) : null}
          {panel.notes ? <p className="m-0 text-[13px] text-ink-dim">{panel.notes}</p> : null}
        </div>
      ) : null}

      <StatGrid className="mb-6 grid-cols-2 md:grid-cols-4">
        <Stat label="Out of range" sub={out.length ? [high && `${high} high`, low && `${low} low`, out.length - high - low > 0 && `${out.length - high - low} flagged`].filter(Boolean).join(' · ') : 'Everything within range'}>
          <span className={out.length ? 'text-high' : undefined}>{out.length}</span>
        </Stat>
        <Stat label="In range" sub={other.length ? `${other.length} without a reported range` : 'of results with a range'}>
          {inRange.length}
        </Stat>
        <Stat label="First measured" sub={firstTime ? 'tests new on this report' : 'all measured before'}>
          {firstTime}
        </Stat>
        <Stat label="Previous report" sub={previousDraw ? previousDraw.facility || 'Earlier draw' : 'This is the first draw'}>
          {previousDraw ? formatDate(previousDraw.draw_date, 'short') : '—'}
        </Stat>
      </StatGrid>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-ink-faint">{plural(rows.length, 'result')} on this report</span>
        <Segmented
          label="Group results"
          value={groupBy}
          onChange={(v) => update({ group: v === 'status' ? null : v, result: null }, true)}
          options={[
            { value: 'status', label: 'By result' },
            { value: 'type', label: 'By test type' },
          ]}
        />
      </div>
      <div className="grid gap-6">
        {sections
          .filter((section) => section.items.length)
          .map((section) => (
            <section key={section.key}>
              <SectionHeader title={section.title} meta={section.meta || plural(section.items.length, 'result')} actions={section.actions} />
              {list(section.items)}
            </section>
          ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="pencil" onClick={() => setEditDraw(true)}>
            Edit draw
          </Button>
          <SourceReports panel={panel} />
          <ButtonLink to="/markers" size="sm" variant="ghost" icon="flask">
            All tests
          </ButtonLink>
          <Button size="sm" variant="ghost" icon="trash" className="ml-auto text-high hover:text-high" onClick={() => setConfirmDelete(true)}>
            Delete draw
          </Button>
        </div>
      </div>
      {editing ? (
        <ResultEditModal
          subjectId={ds.subjectId}
          result={editing.result}
          markerName={editing.marker.name}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await ds.reload()
          }}
        />
      ) : null}
      {editDraw ? (
        <PanelEditModal
          panel={panel}
          onClose={() => setEditDraw(false)}
          onSaved={async () => {
            setEditDraw(false)
            await ds.reload()
          }}
        />
      ) : null}
      {confirmDelete ? (
        <Modal
          title="Delete this draw?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                variant="danger"
                busy={remove.busy}
                onClick={() =>
                  remove.run(async () => {
                    await api.del(`/subjects/${ds.subjectId}/panels/${panel.id}`)
                    setConfirmDelete(false)
                    await ds.reload()
                    navigate('/', { replace: true })
                  })
                }
              >
                Delete {plural(panel.result_count, 'result')}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 text-[13.5px]">
            <p className="m-0">
              The draw from {formatDate(panel.draw_date)} and its {plural(panel.result_count, 'result')} will be deleted for good
              {panel.sources.length ? `, along with ${panel.sources.length > 1 ? 'the uploaded reports' : 'the uploaded report'} they came from unless another draw also uses ${panel.sources.length > 1 ? 'them' : 'it'}` : ''}. This cannot be undone.
            </p>
            {remove.error ? <Alert tone="error">{remove.error}</Alert> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
