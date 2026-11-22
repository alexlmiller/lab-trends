import { SelectField } from '../components/SelectField'
import { useState } from 'react'
import { periodLabel } from '../../shared/events'
import type { EventKind, EventPeriod, TimelineEvent } from '../../shared/types'
import { EVENT_COLORS } from '../charts/TimeSeriesChart'
import { Icon } from '../components/Icon'
import { MarkerPicker } from '../components/MarkerPicker'
import { Alert, Button, ButtonLink, Card, cx, Empty, Field, inputClass, Modal, PageHeader } from '../components/ui'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { useDataset } from '../lib/data'

const KINDS: { value: EventKind; label: string }[] = [
  { value: 'medication', label: 'Medication' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'illness', label: 'Illness / flare' },
  { value: 'location', label: 'Location' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'other', label: 'Other' },
]

export function EventsPage() {
  const ds = useDataset()
  const [editing, setEditing] = useState<Partial<TimelineEvent> | null>(null)
  const sorted = [...ds.events].sort((a, b) => b.periods.at(-1)!.start_date.localeCompare(a.periods.at(-1)!.start_date))
  return (
    <div className="grid max-w-4xl gap-4">
      <PageHeader
        title="Events"
        description="Medications, procedures, illnesses and other events, shown on every chart. Add another date or period each time the same event recurs."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing({ kind: 'medication', start_date: '', marker_ids: [] })}>
            Add event
          </Button>
        }
      />
      {sorted.length ? (
        <Card padded={false}>
          {sorted.map((e) => (
            <div key={e.id} className="flex flex-col border-b border-line last:border-b-0 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setEditing(e)}
                className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left hover:bg-elevated"
              >
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: EVENT_COLORS[e.kind] }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{e.label}</span>
                  <span className="block text-[12.5px] text-ink-dim tabular">
                    {KINDS.find((k) => k.value === e.kind)?.label}
                    {e.marker_ids.length
                      ? ` · ${e.marker_ids
                          .map((id) => ds.markersById.get(id)?.name)
                          .filter(Boolean)
                          .join(', ')}`
                      : ''}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {e.periods.map((p) => (
                      <span key={p.start_date} title={p.note ?? undefined} className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-sunken px-2.5 text-[12px] text-ink-dim tabular">
                        <span className="shrink-0">{periodLabel(p)}</span>
                        {p.note ? <span className="truncate text-ink-faint">· {p.note}</span> : null}
                      </span>
                    ))}
                  </span>
                  {e.notes ? <span className="mt-0.5 block text-[12.5px] text-ink-faint">{e.notes}</span> : null}
                </span>
                <Icon name="pencil" className="mt-1 text-ink-faint" />
              </button>
              <ButtonLink to={'/history?event=' + encodeURIComponent(e.id)} size="sm" variant="ghost" icon="chart" aria-label={'View ' + e.label + ' in History'} className="mx-3 mb-3 self-start sm:mb-0">
                History
              </ButtonLink>
            </div>
          ))}
        </Card>
      ) : (
        <Empty title="No events yet" icon="calendar">
          Add the start and stop of medications (e.g. a biologic), procedures, infections or flares. Periods show as shaded spans;
          single days as lines.
        </Empty>
      )}
      {editing ? <EventModal event={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function EventModal({ event, onClose }: { event: Partial<TimelineEvent>; onClose: () => void }) {
  const ds = useDataset()
  const [label, setLabel] = useState(event.label ?? '')
  const [kind, setKind] = useState<EventKind>(event.kind ?? 'other')
  const blank: EventPeriod = { start_date: '', end_date: null, ongoing: false, note: null }
  const [periods, setPeriods] = useState<EventPeriod[]>(event.periods ?? [blank])
  const updatePeriod = (index: number, patch: Partial<EventPeriod>) =>
    setPeriods((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  const [notes, setNotes] = useState(event.notes ?? '')
  const [markerIds, setMarkerIds] = useState<string[]>(event.marker_ids ?? [])
  const { busy, error, run } = useAction()
  const body = { label, kind, updated_at: event.updated_at, periods, notes, marker_ids: markerIds }
  const path = `/subjects/${ds.subjectId}/events`
  // The server answers with the saved event, so the timeline is updated in place rather than fetched again.
  const save = () =>
    run(async () => {
      const { event: saved } = event.id ? await api.patch<{ event: TimelineEvent }>(`${path}/${event.id}`, body) : await api.post<{ event: TimelineEvent }>(path, body)
      ds.patch((d) => ({ ...d, events: [...d.events.filter((e) => e.id !== saved.id), saved].sort((a, b) => a.start_date.localeCompare(b.start_date)) }))
      onClose()
    })
  const remove = () =>
    run(async () => {
      await api.del(`${path}/${event.id}`)
      ds.patch((d) => ({ ...d, events: d.events.filter((e) => e.id !== event.id) }))
      onClose()
    })
  return (
    <Modal
      wide
      title={event.id ? 'Edit event' : 'Add event'}
      onClose={onClose}
      footer={
        <>
          {event.id ? (
            <Button
              variant="ghost"
              icon="trash"
              className="mr-auto"
              onClick={remove}
            >
              Delete
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!label.trim() || periods.some((p) => !p.start_date)}
            onClick={save}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="What">
            <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Methotrexate, knee surgery, COVID" data-autofocus />
          </Field>
          <SelectField label="Kind" value={kind} onChange={(value) => setKind(value as EventKind)} options={KINDS} />
        </div>
        <section className="grid gap-1.5" aria-label="Dates and periods">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium text-ink-dim">
              Dates and periods <span className="font-normal text-ink-faint">· leave End blank for a single day</span>
            </span>
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setPeriods((current) => [...current, blank])}>
              Add
            </Button>
          </div>
          <div className="hidden grid-cols-[8.75rem_8.75rem_4.5rem_minmax(0,1fr)_2rem] gap-2 px-0.5 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase sm:grid">
            <span>Start</span>
            <span>End</span>
            <span>Ongoing</span>
            <span>Note</span>
          </div>
          <div className="grid gap-2 sm:gap-1.5">
            {periods.map((period, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-x-2 gap-y-1.5 rounded-md border border-line p-2 sm:grid-cols-[8.75rem_8.75rem_4.5rem_minmax(0,1fr)_2rem] sm:border-0 sm:p-0">
                <input type="date" aria-label={`Period ${i + 1} start`} className={cx(inputClass, 'h-8 px-2 text-[13px]')} value={period.start_date} onChange={(e) => updatePeriod(i, { start_date: e.target.value })} />
                <input
                  type="date"
                  aria-label={`Period ${i + 1} end`}
                  className={cx(inputClass, 'h-8 px-2 text-[13px] disabled:opacity-40')}
                  min={period.start_date}
                  disabled={period.ongoing}
                  value={period.end_date ?? ''}
                  onChange={(e) => updatePeriod(i, { end_date: e.target.value || null })}
                />
                <button
                  type="button"
                  aria-label={`Remove period ${i + 1}`}
                  disabled={periods.length < 2}
                  onClick={() => setPeriods((current) => current.filter((_, n) => n !== i))}
                  className="col-start-3 row-start-1 grid size-8 place-items-center rounded-md text-ink-faint hover:bg-sunken hover:text-ink disabled:invisible sm:col-start-5"
                >
                  <Icon name="x" />
                </button>
                <label className="flex h-8 items-center gap-1.5 text-[13px] text-ink-dim sm:col-start-3 sm:row-start-1 sm:justify-center">
                  <input type="checkbox" className="size-4 accent-accent" checked={period.ongoing} onChange={(e) => updatePeriod(i, { ongoing: e.target.checked, end_date: null })} />
                  <span className="sm:sr-only">Ongoing</span>
                </label>
                <input
                  aria-label={`Period ${i + 1} note`}
                  className={cx(inputClass, 'col-span-2 h-8 px-2 text-[13px] sm:col-span-1 sm:col-start-4 sm:row-start-1')}
                  placeholder="Note: dose, reason, where…"
                  value={period.note ?? ''}
                  onChange={(e) => updatePeriod(i, { note: e.target.value })}
                />
              </div>
            ))}
          </div>
        </section>
        <Field label="Notes about the event">
          <textarea className={`${inputClass} h-20 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Show on" hint="Leave empty to show on every chart">
          <div className="grid gap-1.5">
            {markerIds.length ? (
              <div className="flex flex-wrap gap-1">
                {markerIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[12.5px]">
                    {ds.markersById.get(id)?.name ?? id}
                    <button type="button" aria-label="Remove" onClick={() => setMarkerIds(markerIds.filter((x) => x !== id))}>
                      <Icon name="x" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <MarkerPicker
              compact
              placeholder="All tests (or pick specific ones)"
              options={ds.markers
                .filter((m) => !markerIds.includes(m.id))
                .map((m) => ({ id: m.id, name: m.name, long_name: m.long_name, category: m.category, aliases: m.aliases }))}
              onPick={(id) => setMarkerIds([...markerIds, id])}
            />
          </div>
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Modal>
  )
}
