import { useState } from 'react'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { plural } from '../lib/format'
import { Alert, Button, Modal } from './ui'

/** Remove a marker and all its results from one person's record. */
export function DeleteMarkerModal({
  subjectId,
  marker,
  resultCount,
  personName,
  onClose,
  onDeleted,
}: {
  subjectId: string
  marker: { id: string; name: string }
  resultCount: number
  personName: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [hide, setHide] = useState(true)
  const { busy, error, run } = useAction()
  return (
    <Modal
      title={`Delete ${marker.name}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            icon="trash"
            busy={busy}
            onClick={async () => {
              if (await run(() => api.del(`/subjects/${subjectId}/markers/${marker.id}?hide=${hide ? '1' : '0'}`))) onDeleted()
            }}
          >
            Delete {plural(resultCount, 'result')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-[13.5px]">
        <p className="m-0">
          This deletes {marker.name} and its {plural(resultCount, 'result')} from {personName}’s record for good, along with any target set for it. Draws left with no other results are deleted too. It cannot be undone.
        </p>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
          <span>
            Leave it out of future imports
            <span className="block text-[12.5px] text-ink-dim">Rows for {marker.name} will arrive unticked in review. You can allow it again in Settings.</span>
          </span>
        </label>
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Modal>
  )
}
