import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatDate } from '../../shared/dates'
import type { MarkerSeries, PersonalTarget, Result } from '../../shared/types'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { useDataset } from '../lib/data'
import { formatNumber, plural } from '../lib/format'
import { resultChange } from '../lib/report'
import { resultStatus, statusTone } from '../../shared/semantics'
import { DeleteMarkerModal } from './DeleteMarker'
import { ResultEditModal } from './ResultEdit'
import { Alert, Button, cx, Field, inputClass, SectionHeader, StatusBadge } from './ui'
import { drawPath } from '../lib/history'

export function TestRecord({ marker }: { marker: MarkerSeries }) {
  const ds = useDataset()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Result | null>(null)
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="grid gap-4">
      <section>
        <SectionHeader
          title="All results"
          meta={`${plural(marker.results.length, 'draw')} · ${marker.results.filter((r) => r.lab_flag).length} flagged`}
          actions={
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(true)}>
              Delete test
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <table className="history-results w-full min-w-[720px] border-collapse text-[13px] tabular">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
                <th className="py-1.5 pr-3">Date</th>
                <th className="py-1.5 pr-3">Value</th>
                <th className="py-1.5 pr-3">Change</th>
                <th className="py-1.5 pr-3">Reference</th>
                <th className="py-1.5 pr-3">Flag</th>
                <th className="py-1.5 pr-3">Source</th>
                <th className="py-1.5 pr-3">Context</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...marker.results].reverse().map((r, i, arr) => {
                const before = arr[i + 1]
                const change = resultChange(before, r)
                const st = statusTone(resultStatus(r))
                return (
                  <tr key={r.id} className="border-t border-line hover:bg-elevated">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <Link to={drawPath(r.panel_id, r.id)} className="text-ink">
                        {formatDate(r.draw_date)}
                      </Link>
                    </td>
                    <td
                      className={cx(
                        'py-1.5 pr-3 font-medium whitespace-nowrap',
                        st === 'high' && 'text-high',
                        st === 'low' && 'text-low',
                      )}
                    >
                      {r.raw_value} <span className="font-normal text-ink-faint">{r.raw_units}</span>
                    </td>
                    <td data-label="Change" title={change.note} className="py-1.5 pr-3 whitespace-nowrap text-ink-dim">
                      {change.value} {change.unit}
                    </td>
                    <td data-label="Reference" className="py-1.5 pr-3 text-ink-dim">
                      {r.reference_text ?? '—'}
                    </td>
                    <td data-label="Flag" className="py-1.5 pr-3">
                      {r.lab_flag ? (
                        <span title={r.flag_source === 'inferred' ? 'Inferred from the reported range' : 'Flagged on the report'}>
                          <StatusBadge status={st ?? 'high'}>{r.lab_flag}</StatusBadge>
                          {r.flag_source === 'inferred' ? <span className="ml-1 text-[11px] text-ink-faint">inferred</span> : null}
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Source" className="py-1.5 pr-3 text-ink-dim">
                      {r.facility ?? ''}
                    </td>
                    <td data-label="Context" className="py-1.5 pr-3 text-ink-dim">
                      {[...r.panel_tags, r.notes, r.corrected_at ? 'corrected' : null].filter(Boolean).join(' · ')}
                    </td>
                    <td className="py-1 text-right">
                      <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(r)} aria-label="Edit result" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {deleting ? (
        <DeleteMarkerModal
          subjectId={ds.subjectId}
          marker={marker}
          resultCount={marker.results.length}
          personName={ds.subject.display_name}
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            await ds.reload()
            navigate('/history', { replace: true })
          }}
        />
      ) : null}
      {editing ? (
        <ResultEditModal
          subjectId={ds.subjectId}
          result={editing}
          markerName={marker.name}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await ds.reload()
          }}
        />
      ) : null}
    </div>
  )
}

export function TargetEditor({ marker }: { marker: MarkerSeries }) {
  const ds = useDataset()
  const [open, setOpen] = useState(false)
  const [low, setLow] = useState(marker.target?.target_low?.toString() ?? '')
  const [high, setHigh] = useState(marker.target?.target_high?.toString() ?? '')
  const [note, setNote] = useState(marker.target?.note ?? '')
  const { busy, error, run } = useAction()
  const save = (clear = false) =>
    run(async () => {
      const body = clear ? {} : { target_low: low === '' ? null : Number(low), target_high: high === '' ? null : Number(high), note: note || null }
      const { target } = await api.put<{ target: PersonalTarget | null }>(`/subjects/${ds.subjectId}/targets/${marker.id}`, body)
      ds.patch((d) => ({ ...d, markers: d.markers.map((m) => (m.id === marker.id ? { ...m, target } : m)) }))
      setOpen(false)
    })
  const t = marker.target
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px]">
          <span className="text-ink-faint">Your target </span>
          {t ? (
            <b>
              {t.target_low != null && t.target_high != null
                ? `${formatNumber(t.target_low)} – ${formatNumber(t.target_high)}`
                : t.target_high != null
                  ? `≤ ${formatNumber(t.target_high)}`
                  : `≥ ${formatNumber(t.target_low)}`}
            </b>
          ) : (
            <span className="text-ink-faint">none</span>
          )}
          {t?.note ? <span className="text-ink-dim"> · {t.note}</span> : null}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {t ? 'Edit' : 'Set target'}
        </Button>
      </div>
      {open ? (
        <div className="mt-2 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="At least">
              <input className={inputClass} inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
            </Field>
            <Field label="At most">
              <input className={inputClass} inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
            </Field>
          </div>
          <Field label="Why (optional)">
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            {t ? (
              <Button size="sm" variant="ghost" onClick={() => save(true)} busy={busy}>
                Remove
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={() => save()} busy={busy} disabled={low === '' && high === ''}>
              Save target
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
