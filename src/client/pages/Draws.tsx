import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatDate } from '../../shared/dates'
import type { Panel } from '../../shared/types'
import { Alert, Button, ButtonLink, Card, cx, Empty, Field, inputClass, Modal, PageHeader } from '../components/ui'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { useDataset } from '../lib/data'
import { drawPath } from '../lib/history'

export function DrawsPage() {
  const ds = useDataset()
  const navigate = useNavigate()
  return (
    <div className="grid gap-3">
      <PageHeader
        title="Draws"
        description="Each draw is one collection date. Results imported from several reports for the same day are combined."
        actions={<ButtonLink to="/import" variant="primary" icon="plus">Add results</ButtonLink>}
      />
      {ds.panels.length ? <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="draws-table w-full min-w-[640px] border-collapse text-[13px] tabular">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Facility</th>
                <th className="px-3 py-2">Results</th>
                <th className="px-3 py-2">Flagged</th>
                <th className="px-3 py-2">Context</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {ds.panels.map((p) => (
                <tr key={p.id} onClick={() => navigate(drawPath(p.id))} className="cursor-pointer border-t border-line hover:bg-elevated">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    <Link to={drawPath(p.id)} className="text-ink">
                      {formatDate(p.draw_date)}
                    </Link>
                    {p.draw_time ? <span className="ml-1 text-ink-faint">{p.draw_time}</span> : null}
                  </td>
                  <td className="draw-facility px-3 py-2 text-ink-dim">{p.facility ?? '—'}</td>
                  <td className="draw-count px-3 py-2"><span>Results </span>{p.result_count}</td>
                  <td className={cx('draw-count px-3 py-2', p.flagged_count > 0 && 'font-semibold text-high')}><span>Flagged </span>{p.flagged_count}</td>
                  <td className="draw-context px-3 py-2 text-ink-dim">{p.tags.join(', ')}</td>
                  <td className="draw-context max-w-[260px] truncate px-3 py-2 text-ink-faint">{p.sources.map((s) => s.filename).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card> : <Empty title="No draws yet" icon="file" />}
    </div>
  )
}

export function PanelEditModal({ panel, onClose, onSaved }: { panel: Panel; onClose: () => void; onSaved: () => void }) {
  const ds = useDataset()
  const [date, setDate] = useState(panel.draw_date)
  const [time, setTime] = useState(panel.draw_time ?? '')
  const [facility, setFacility] = useState(panel.facility ?? '')
  const [provider, setProvider] = useState(panel.ordering_provider ?? '')
  const [tags, setTags] = useState(panel.tags.join(', '))
  const [notes, setNotes] = useState(panel.notes ?? '')
  const { busy, error, run } = useAction()
  return (
    <Modal
      title="Edit draw"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              const body = { draw_date: date, draw_time: time || null, facility, ordering_provider: provider, notes, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }
              if (await run(() => api.patch(`/subjects/${ds.subjectId}/panels/${panel.id}`, body))) onSaved()
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Collection date">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time">
            <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Facility">
          <input className={inputClass} value={facility} onChange={(e) => setFacility(e.target.value)} />
        </Field>
        <Field label="Ordering provider">
          <input className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)} />
        </Field>
        <Field label="Context tags" hint="Comma separated, e.g. “cycle day 3, fasting, during flare”. Shown on every chart tooltip for this draw.">
          <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className={`${inputClass} h-20 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Modal>
  )
}
