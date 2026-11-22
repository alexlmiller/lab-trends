import { SelectField } from '../components/SelectField'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CATEGORIES, categoryLabel, sortCategories } from '../../shared/categories'
import type { Marker } from '../../shared/types'
import { Icon } from '../components/Icon'
import { DeleteMarkerModal } from '../components/DeleteMarker'
import { MarkerPicker } from '../components/MarkerPicker'
import { Alert, Button, Card, cx, Field, inputClass, Modal, PageHeader, Spinner } from '../components/ui'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { useData, useDataset } from '../lib/data'

export function MarkersAdminPage() {
  const ds = useDataset()
  const { catalog, loadCatalog } = useData()
  const [editing, setEditing] = useState<Marker | null>(null)
  const [merging, setMerging] = useState<Marker | null>(null)
  const [deleting, setDeleting] = useState<Marker | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const rows = useMemo(() => {
    const list = (catalog ?? []).filter((m) => showAll || ds.markersById.has(m.id))
    const cats = sortCategories([...new Set(list.map((m) => m.category))])
    return cats.map((c) => ({ c, markers: list.filter((m) => m.category === c).sort((a, b) => a.name.localeCompare(b.name)) }))
  }, [catalog, ds.markersById, showAll])

  if (!catalog) return <Spinner label="Loading tests…" />
  const refresh = async () => {
    await Promise.all([loadCatalog(), ds.reload()])
  }
  return (
    <div className="grid max-w-5xl gap-4">
      <PageHeader
        title="Test catalog"
        description="Rename or recategorize tests, and merge duplicates (the same test imported under two names) so their history becomes one series."
        actions={
          <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Only tests with results' : 'Show full catalog'}
          </Button>
        }
      />
      {rows.map(({ c, markers }) => (
        <Card key={c} padded={false}>
          <div className="border-b border-line bg-elevated px-4 py-2 text-[12px] font-semibold tracking-[0.06em] text-ink-dim uppercase">{categoryLabel(c)}</div>
          {markers.map((m) => {
            const series = ds.markersById.get(m.id)
            return (
              <div key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0">
                <div className="min-w-0 flex-1">
                  {series ? (
                    <Link to={`/history?m=${m.id}`} className="font-semibold text-ink">
                      {m.name}
                    </Link>
                  ) : (
                    <span className="font-semibold">{m.name}</span>
                  )}
                  {m.is_custom ? <span className="ml-1.5 rounded bg-sunken px-1 text-[10.5px] text-ink-faint uppercase">custom</span> : null}
                  <div className="truncate text-[12px] text-ink-faint">{[m.long_name, m.default_units, m.aliases?.slice(0, 4).join(', ')].filter(Boolean).join(' · ')}</div>
                </div>
                <span className={cx('w-20 text-right text-[12px] tabular', series ? 'text-ink-dim' : 'text-ink-faint')}>{series ? `${series.results.length} results` : '—'}</span>
                <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`} />
                {series ? <Button size="sm" variant="ghost" icon="merge" onClick={() => setMerging(m)} aria-label={`Merge ${m.name}`} /> : null}
                {series ? <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(m)} aria-label={`Delete ${m.name}`} /> : null}
              </div>
            )
          })}
        </Card>
      ))}
      {editing ? <EditMarker marker={editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {deleting ? (
        <DeleteMarkerModal
          subjectId={ds.subjectId}
          marker={deleting}
          resultCount={ds.markersById.get(deleting.id)?.results.length ?? 0}
          personName={ds.subject.display_name}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null)
            await refresh()
          }}
        />
      ) : null}
      {merging ? <MergeMarker marker={merging} catalog={catalog} onClose={() => setMerging(null)} onSaved={refresh} /> : null}
    </div>
  )
}

function EditMarker({ marker, onClose, onSaved }: { marker: Marker; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(marker.name)
  const [longName, setLongName] = useState(marker.long_name ?? '')
  const [category, setCategory] = useState(marker.category)
  const [units, setUnits] = useState(marker.default_units ?? '')
  const [description, setDescription] = useState(marker.description ?? '')
  const { busy, error, run } = useAction()
  return (
    <Modal
      title={`Edit ${marker.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() =>
              run(async () => {
                await api.patch(`/markers/${marker.id}`, { name, long_name: longName, category, default_units: units, description })
                await onSaved()
                onClose()
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {!marker.is_custom ? <Alert tone="info">This is a built-in test; changes apply for everyone using this app.</Alert> : null}
        <Field label="Short name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Full name">
          <input className={inputClass} value={longName} onChange={(e) => setLongName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Category" value={category} onChange={setCategory} options={CATEGORIES.map(c => ({ value: c.slug, label: c.label, keywords: c.aliases.join(' ') }))} />
          <Field label="Usual units">
            <input className={inputClass} value={units} onChange={(e) => setUnits(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className={`${inputClass} h-24 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Modal>
  )
}

function MergeMarker({ marker, catalog, onClose, onSaved }: { marker: Marker; catalog: Marker[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [target, setTarget] = useState<Marker | null>(null)
  const { busy, error, run } = useAction()
  return (
    <Modal
      title={`Merge ${marker.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!target}
            onClick={() =>
              run(async () => {
                await api.post(`/markers/${marker.id}/merge`, { into_id: target!.id })
                await onSaved()
                onClose()
              })
            }
          >
            Merge into {target?.name ?? '…'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="m-0 text-[13.5px] text-ink-dim">
          All results for <b className="text-ink">{marker.name}</b> move to the test you pick, and its name becomes an alias so future imports land there too. Units are not converted.
        </p>
        {target ? (
          <div className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-[13px]">
            <Icon name="merge" /> {marker.name} → <b>{target.name}</b> ({categoryLabel(target.category)}, {target.default_units ?? 'no units'})
            <button type="button" className="ml-auto text-ink-faint" onClick={() => setTarget(null)} aria-label="Clear">
              <Icon name="x" />
            </button>
          </div>
        ) : (
          <MarkerPicker
            autoFocus
            options={catalog.filter((m) => m.id !== marker.id).map((m) => ({ id: m.id, name: m.name, long_name: m.long_name, category: m.category, aliases: m.aliases }))}
            onPick={(id) => setTarget(catalog.find((m) => m.id === id) ?? null)}
            placeholder="Merge into…"
          />
        )}
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Modal>
  )
}
