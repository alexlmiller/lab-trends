import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { SavedView } from '../../shared/types'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { useDataset } from '../lib/data'
import { PRESETS } from '../lib/presets'
import { Alert, Button, Field, inputClass, Modal } from './ui'

export function HistoryViews({ ids, onChoose, onClose }: { ids: string[]; onChoose: (ids: string[]) => void; onClose: () => void }) {
  const ds = useDataset()
  const navigate = useNavigate()
  const location = useLocation()
  const [name, setName] = useState('')
  const { busy, error, run } = useAction()
  const bySlug = new Map(ds.markers.filter((m) => m.results.length).map((m) => [m.slug, m.id]))
  const presets = PRESETS.map((p) => ({ name: p.name, ids: p.slugs.flatMap((slug) => bySlug.get(slug) ?? []) })).filter(
    (p) => p.ids.length >= 2,
  )
  const save = () =>
    run(async () => {
      if (!name.trim()) return
      const params = new URLSearchParams(location.search)
      params.set('m', ids.join(','))
      const view = await api.post<SavedView>('/subjects/' + ds.subjectId + '/views', { name: name.trim(), path: '/history?' + params })
      ds.patch((d) => ({ ...d, saved_views: [...d.saved_views, view] }))
      onClose()
    })
  const remove = (id: string) =>
    run(async () => {
      await api.del('/subjects/' + ds.subjectId + '/views/' + id)
      ds.patch((d) => ({ ...d, saved_views: d.saved_views.filter((v) => v.id !== id) }))
    })
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
                  onClick={() => remove(v.id)}
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
