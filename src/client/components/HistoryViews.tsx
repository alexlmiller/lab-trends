import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useDataset } from '../lib/data'
import { PRESETS } from '../lib/presets'
import { Alert, Button, Field, inputClass, Modal } from './ui'

export function HistoryViews({ ids, onChoose, onClose }: { ids: string[]; onChoose: (ids: string[]) => void; onClose: () => void }) {
  const ds = useDataset()
  const navigate = useNavigate()
  const location = useLocation()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bySlug = new Map(ds.markers.filter((m) => m.results.length).map((m) => [m.slug, m.id]))
  const presets = PRESETS.map((p) => ({ name: p.name, ids: p.slugs.flatMap((slug) => bySlug.get(slug) ?? []) })).filter(
    (p) => p.ids.length >= 2,
  )
  async function save() {
    if (busy || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const params = new URLSearchParams(location.search)
      params.set('m', ids.join(','))
      await api.post('/subjects/' + ds.subjectId + '/views', { name: name.trim(), path: '/history?' + params })
      await ds.reload()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="History views" onClose={onClose}>
      <div className="grid gap-4">
        {presets.length > 0 && (
          <section>
            <h3 className="font-semibold">Test groups</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {presets.map((p) => (
                <Button
                  key={p.name}
                  size="sm"
                  onClick={() => {
                    onChoose(p.ids)
                    onClose()
                  }}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          </section>
        )}
        {ds.saved_views.length > 0 && (
          <section>
            <h3 className="font-semibold">Saved views</h3>
            {ds.saved_views.map((v) => (
              <div key={v.id} className="flex justify-between items-center border-b border-line">
                <button
                  type="button"
                  className="py-2 text-left text-accent-deep underline"
                  onClick={() => {
                    onClose()
                    navigate(v.path)
                  }}
                >
                  {v.name}
                </button>
                <Button
                  icon="trash"
                  variant="ghost"
                  size="sm"
                  aria-label={'Delete saved view ' + v.name}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setError('')
                    try {
                      await api.del('/subjects/' + ds.subjectId + '/views/' + v.id)
                      await ds.reload()
                    } catch (e) {
                      setError((e as Error).message)
                    } finally {
                      setBusy(false)
                    }
                  }}
                />
              </div>
            ))}
          </section>
        )}
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="Save this view as">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" size="sm" variant="primary" disabled={!name.trim()} busy={busy}>
              Save view
            </Button>
          </div>
        </form>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
