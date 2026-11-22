import { SelectField } from './SelectField'
import { useState } from 'react'
import { formatDate } from '../../shared/dates'
import type { Result } from '../../shared/types'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { Alert, Button, Field, inputClass, Modal } from './ui'

export const FLAG_OPTIONS = ['low', 'high', 'critical', 'abnormal'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))

export function ResultEditModal({ subjectId, result, markerName, onClose, onSaved }: { subjectId: string; result: Result; markerName: string; onClose: () => void; onSaved: () => void }) {
  const [rawValue, setRawValue] = useState(result.raw_value)
  const [units, setUnits] = useState(result.raw_units ?? '')
  const [reference, setReference] = useState(result.reference_text ?? '')
  const [flag, setFlag] = useState(result.flag_source === 'reported' ? (result.lab_flag ?? '') : '')
  const [notes, setNotes] = useState(result.notes ?? '')
  const { busy, error, run } = useAction()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const path = `/subjects/${subjectId}/results/${result.id}`
  const save = async () => {
    if (await run(() => api.patch(path, { raw_value: rawValue, raw_units: units || null, reference_text: reference || null, lab_flag: flag || null, notes: notes || null }))) onSaved()
  }
  const remove = async () => {
    if (await run(() => api.del(path))) onSaved()
  }

  return (
    <Modal
      title={`${markerName} · ${formatDate(result.draw_date)}`}
      onClose={onClose}
      footer={
        <>
          {confirmDelete ? (
            <Button variant="danger" onClick={remove} busy={busy} className="mr-auto">
              Delete permanently
            </Button>
          ) : (
            <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)} className="mr-auto">
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} busy={busy}>
            Save correction
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="m-0 text-[13px] text-ink-dim">Enter values exactly as the report shows them. Numbers, ranges and inferred flags are recomputed from the text. The version you replace is kept until the result is deleted.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Value as reported">
            <input className={inputClass} value={rawValue} onChange={(e) => setRawValue(e.target.value)} />
          </Field>
          <Field label="Units">
            <input className={inputClass} value={units} onChange={(e) => setUnits(e.target.value)} />
          </Field>
          <Field label="Reference range as reported">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 3.8-10.8 or <3.0" />
          </Field>
          <SelectField label="Flag on the report" value={flag} onChange={setFlag} options={[{ value: '', label: 'None (infer from range)' }, ...FLAG_OPTIONS]} />
        </div>
        <Field label="Note">
          <textarea className={`${inputClass} h-20 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {confirmDelete ? <Alert tone="warn">This deletes the result and its earlier versions for good. It cannot be undone.</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Modal>
  )
}
