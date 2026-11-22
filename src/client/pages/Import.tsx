import { SelectField } from '../components/SelectField'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CATEGORIES, categoryLabel } from '../../shared/categories'
import { formatDate, parseLooseDate } from '../../shared/dates'
import { sameReportedValue } from '../../shared/semantics'
import type { Candidate, CommitSummary, ExtractedResult, ExtractionDocument, ImportBatch, Marker } from '../../shared/types'
import { Icon } from '../components/Icon'
import { MarkerPicker } from '../components/MarkerPicker'
import { Alert, Button, Card, cx, Field, inputClass, PageHeader, Spinner } from '../components/ui'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { useData, useDataset } from '../lib/data'
import { plural } from '../lib/format'
import { drawPath } from '../lib/history'
import { ImportGuide } from '../components/ImportGuide'

type DrawInfo = { draw_date: string | null; draw_time: string | null; facility: string | null; tags: string[] }

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

type BatchListItem = Omit<ImportBatch, 'candidates'> & { candidates: { id: string; status: string; filename: string | null; source_kind: string }[] }

export function ImportPage() {
  const ds = useDataset()
  const { me } = useData()
  const documentImports = me?.document_imports !== false
  // Ids starting with @cf/ are Workers AI models, run by Cloudflare; anything else is another provider.
  const outside = [...new Set([me?.extraction_models?.pdf, me?.extraction_models?.photo])].filter((m): m is string => Boolean(m) && !m!.startsWith('@cf/'))
  const navigate = useNavigate()
  const [batches, setBatches] = useState<BatchListItem[] | null>(null)
  const [drag, setDrag] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<BatchListItem[]>(`/subjects/${ds.subjectId}/imports`).then(setBatches).catch((e: Error) => setError(e.message))
  }, [ds.subjectId])

  const upload = (files: File[]) => {
    if (!files.length) return
    setError(null)
    setProgress(0)
    const form = new FormData()
    for (const f of files) form.append('files', f)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/subjects/${ds.subjectId}/imports`)
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total)
    xhr.onload = () => {
      setProgress(null)
      try {
        const body = JSON.parse(xhr.responseText)
        if (xhr.status >= 400) throw new Error(body.error ?? 'Upload failed')
        navigate(`/import/${body.id}`)
      } catch (e) {
        setError((e as Error).message)
      }
    }
    xhr.onerror = () => {
      setProgress(null)
      setError('Upload failed. Check your connection and try again.')
    }
    xhr.send(form)
  }

  return (
    <div className="grid max-w-4xl gap-5">
      <PageHeader title="Import results" description="Upload lab reports and spreadsheets. Each file becomes a draft you review and correct before anything reaches the charts." />
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          upload([...e.dataTransfer.files])
        }}
        className={cx('grid place-items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors', drag ? 'border-accent bg-accent-tint' : 'border-line-strong bg-surface')}
      >
        <Icon name="upload" size={24} className="text-ink-faint" />
        <div className="font-semibold">Drop files here</div>
        <div className="text-[13px] text-ink-dim">{documentImports ? 'PDF reports (e.g. MyChart exports), photos or screenshots, CSV, or XLSX lab-history sheets' : 'CSV or XLSX lab-history sheets'}</div>
        <div className="flex gap-2">
          <Button variant="primary" icon="upload" onClick={() => inputRef.current?.click()} busy={progress != null}>
            {progress != null ? `Uploading ${Math.round(progress * 100)}%` : 'Choose files'}
          </Button>
          <Button
            onClick={async () => {
              const b = await api.post<{ id: string }>(`/subjects/${ds.subjectId}/imports/manual`)
              navigate(`/import/${b.id}`)
            }}
          >
            Enter manually
          </Button>
        </div>
        <input ref={inputRef} type="file" multiple hidden accept={documentImports ? '.pdf,image/*,.csv,.xlsx,.xlsm' : '.csv,.xlsx,.xlsm'} onChange={(e) => upload([...(e.target.files ?? [])])} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Alert tone="info">
        {documentImports
          ? `Spreadsheets are parsed inside the app. A PDF is turned into text, and names, dates of birth, record numbers, addresses, phone numbers and email addresses are removed where the report labels them, before an AI model ${outside.length ? 'outside Cloudflare' : 'on Cloudflare Workers AI'} reads it. A name or number printed without a label can still reach the model. Photos are sent to the model as they are, with nothing removed. A file’s name is never sent. Results are matched to known markers; you can remap any row before committing.`
          : 'This deployment has no extraction queue, so it imports spreadsheets only.'}
      </Alert>
      {documentImports && me?.ai_gateway ? (
        <Alert tone="warn">
          This deployment sends what the model reads through a Cloudflare AI Gateway. Depending on how that gateway is set up, it can keep a log or a cached copy of report text and photos.
        </Alert>
      ) : null}
      {documentImports && outside.length ? (
        <Alert tone="warn">
          This deployment is set to read uploads with {outside.join(' and ')}, which Cloudflare does not run. Report text and photos are sent to that provider.
        </Alert>
      ) : null}
      <ImportGuide documentImports={documentImports} />

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Recent imports</h2>
        {!batches ? (
          <Spinner />
        ) : batches.length ? (
          <Card padded={false}>
            {batches.map((b) => (
              <Link key={b.id} to={`/import/${b.id}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] text-ink no-underline last:border-b-0 hover:bg-elevated">
                <span className="w-28 shrink-0 text-ink-dim tabular">{formatDate(b.created_at.slice(0, 10))}</span>
                <span className="min-w-0 flex-1 truncate">{b.candidates.map((c) => c.filename ?? 'Manual entry').join(', ')}</span>
                <BatchStatus batch={b} />
              </Link>
            ))}
          </Card>
        ) : (
          <p className="text-[13px] text-ink-faint">Nothing imported yet.</p>
        )}
      </section>
    </div>
  )
}

function BatchStatus({ batch }: { batch: BatchListItem }) {
  if (batch.status === 'committed')
    return <span className="text-[12px] text-good">Committed{batch.summary ? ` · ${plural(batch.summary.results_created + batch.summary.results_replaced, 'result')}` : ''}</span>
  const busy = batch.candidates.some((c) => c.status === 'queued' || c.status === 'processing')
  const failed = batch.candidates.some((c) => c.status === 'failed')
  return <span className={cx('text-[12px] font-medium', failed ? 'text-high' : 'text-warn')}>{busy ? 'Reading…' : failed ? 'Needs attention' : 'Ready to review'}</span>
}

// ─── Review ─────────────────────────────────────────────────────────────

export function ImportReviewPage() {
  const { batchId } = useParams()
  const ds = useDataset()
  const { loadCatalog, catalog } = useData()
  const navigate = useNavigate()
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [docs, setDocs] = useState<Record<string, ExtractionDocument>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const act = useAction()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [summary, setSummary] = useState<CommitSummary | null>(null)

  const load = useCallback(async () => {
    const b = await api.get<ImportBatch>(`/subjects/${ds.subjectId}/imports/${batchId}`)
    setBatch(b)
    setDocs((prev) => {
      const next = { ...prev }
      for (const c of b.candidates) if (c.document && (!prev[c.id] || !dirtyRef.current.has(c.id))) next[c.id] = c.document
      return next
    })
    return b
  }, [ds.subjectId, batchId])
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    void loadCatalog()
    load().catch((e: Error) => setError(e.message))
  }, [load, loadCatalog])

  const pending = batch?.candidates.some((c) => c.status === 'queued' || c.status === 'processing')
  const statuses = batch?.candidates.map((c) => c.id + c.status).join() ?? ''
  // While a file is being read, ask how it is going: a small request, less often as time passes,
  // and not at all while the tab is in the background. The drafts are fetched only when something changed.
  useEffect(() => {
    if (!pending) return
    let timer: ReturnType<typeof setTimeout>
    let delay = 3_000
    let stopped = false
    const ask = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        const now = await api.get<ImportBatch>(`/subjects/${ds.subjectId}/imports/${batchId}?brief=1`)
        if (now.candidates.map((c) => c.id + c.status).join() !== statuses) return void (await load())
      } catch {
        /* keep asking: the next answer may come through */
      }
      delay = Math.min(delay * 1.5, 20_000)
      if (!stopped) timer = setTimeout(ask, delay)
    }
    const onVisible = () => {
      clearTimeout(timer)
      delay = 3_000
      void ask()
    }
    timer = setTimeout(ask, delay)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pending, statuses, load, ds.subjectId, batchId])

  const markers = useMemo(() => {
    const map = new Map<string, Marker>()
    for (const m of catalog ?? []) map.set(m.id, m)
    for (const m of ds.markers) map.set(m.id, m)
    return map
  }, [catalog, ds.markers])
  const options = useMemo(
    () =>
      [...markers.values()].map((m) => ({
        id: m.id,
        name: m.name,
        long_name: m.long_name,
        category: m.category,
        aliases: m.aliases,
        hint: ds.markersById.has(m.id) ? `${categoryLabel(m.category)} · ${ds.markersById.get(m.id)!.results.length} results` : categoryLabel(m.category),
      })),
    [markers, ds.markersById],
  )

  // Shared draw details: several files (e.g. one PDF per test) from one blood draw.
  const [sharedMode, setSharedMode] = useState<boolean | null>(null)
  const [shared, setShared] = useState<DrawInfo>({ draw_date: null, draw_time: null, facility: null, tags: [] })
  const [touched, setTouched] = useState<Set<keyof DrawInfo>>(new Set())
  const readyIds = useMemo(() => (batch?.candidates ?? []).filter((c) => c.status === 'ready').map((c) => c.id), [batch])
  const allPanels = useMemo(() => readyIds.flatMap((id) => docs[id]?.panels ?? []), [readyIds, docs])
  const reportedDates = [...new Set(allPanels.map((p) => p.draw_date).filter((d): d is string => Boolean(d)))].sort()
  const canShare = allPanels.length >= 2
  const isShared = canShare && (sharedMode ?? reportedDates.length <= 1)
  useEffect(() => {
    if (!isShared) return
    setShared((prev) => {
      const next = { ...prev }
      const fill = <K extends 'draw_date' | 'draw_time' | 'facility'>(k: K) => {
        if (!touched.has(k) && !next[k]) next[k] = mostCommon(allPanels.map((p) => p[k] ?? null))
      }
      fill('draw_date')
      fill('draw_time')
      fill('facility')
      if (!touched.has('tags') && !next.tags.length) next.tags = [...new Set(allPanels.flatMap((p) => p.tags ?? []).map((t) => t.trim()).filter(Boolean))]
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
    })
  }, [isShared, allPanels, touched])
  const setSharedField = <K extends keyof DrawInfo>(k: K, v: DrawInfo[K]) => {
    setTouched((t) => new Set(t).add(k))
    setShared((prev) => ({ ...prev, [k]: v }))
  }
  const withShared = (doc: ExtractionDocument): ExtractionDocument =>
    isShared
      ? { ...doc, panels: doc.panels.map((p) => ({ ...p, draw_date: shared.draw_date, draw_time: shared.draw_time, facility: shared.facility, tags: shared.tags.map((t) => t.trim()).filter(Boolean) })) }
      : doc

  const update = (cid: string, fn: (d: ExtractionDocument) => void) => {
    setDocs((prev) => {
      const copy = structuredClone(prev[cid])
      fn(copy)
      return { ...prev, [cid]: copy }
    })
    setDirty((d) => new Set(d).add(cid))
  }
  /** Apply an edit and save it right away, so the server's duplicate check reflects it. */
  const updateAndSave = async (cid: string, fn: (d: ExtractionDocument) => void) => {
    const copy = structuredClone(docs[cid])
    fn(copy)
    setDocs((prev) => ({ ...prev, [cid]: copy }))
    const res = await api.put<{ document: ExtractionDocument }>(`/subjects/${ds.subjectId}/imports/${batchId}/candidates/${cid}`, { document: withShared(copy) })
    setDocs((prev) => ({ ...prev, [cid]: res.document }))
    setDirty((d) => {
      const next = new Set(d)
      next.delete(cid)
      return next
    })
  }

  const saveAll = async () => {
    const ids = isShared ? [...new Set([...dirty, ...readyIds])] : [...dirty]
    for (const cid of ids) {
      if (!docs[cid]) continue
      const res = await api.put<{ document: ExtractionDocument }>(`/subjects/${ds.subjectId}/imports/${batchId}/candidates/${cid}`, { document: withShared(docs[cid]) })
      setDocs((prev) => ({ ...prev, [cid]: res.document }))
    }
    setDirty(new Set())
  }

  if (error) return <Alert tone="error">{error}</Alert>
  if (!batch) return <Spinner label="Loading import…" />

  const live = batch.candidates
  const ready = live.filter((c) => c.status === 'ready')
  const includedCount = ready.reduce((n, c) => n + (docs[c.id]?.panels ?? []).reduce((k, p) => k + p.results.filter((r) => r.include !== false).length, 0), 0)
  const tagUpdates = isShared
    ? shared.tags.some((t) => t.trim()) && shared.draw_date
      ? 1
      : 0
    : ready.reduce((n, c) => n + (docs[c.id]?.panels ?? []).filter((p) => p.tags?.some((t) => t.trim())).length, 0)
  const missingDates = isShared
    ? includedCount > 0 && !shared.draw_date
    : ready.some((c) => (docs[c.id]?.panels ?? []).some((p) => p.results.some((r) => r.include !== false) && !p.draw_date))
  const unmapped = ready.some((c) => (docs[c.id]?.panels ?? []).some((p) => p.results.some((r) => r.include !== false && !r.marker_id && !r.new_marker)))

  if (batch.status === 'committed' || summary) {
    const s = summary ?? batch.summary
    return (
      <div className="grid max-w-2xl gap-4 py-8">
        <PageHeader title="Import committed" />
        {s ? (
          <Card>
            <ul className="m-0 grid gap-1 pl-5 text-[14px]">
              <li>{plural(s.results_created, 'new result')}{s.results_replaced ? `, ${plural(s.results_replaced, 'replaced value')}` : ''}</li>
              <li>{plural(s.panels_created, 'new draw')}{s.panels_merged ? `, added to ${plural(s.panels_merged, 'existing draw')}` : ''}</li>
              {s.markers_created ? <li>{plural(s.markers_created, 'new marker')} created</li> : null}
              {s.duplicates_skipped ? <li>{plural(s.duplicates_skipped, 'duplicate')} skipped (already saved with the same value)</li> : null}
              {s.skipped ? <li>{plural(s.skipped, 'row')} left out</li> : null}
            </ul>
          </Card>
        ) : null}
        {s?.same_day_conflict_count ? (
          <Alert tone="warn">
            <div className="font-medium">{plural(s.same_day_conflict_count, 'result')} not saved: the import had two different values for the same test on the same date.</div>
            <p className="m-0 mt-1">One value per test per date is kept, and the first was saved. Check the report and correct the saved result if the other value is the right one.</p>
            {s.same_day_conflicts ? (
              <>
                <ul className="m-0 mt-1.5 grid gap-0.5 pl-5">
                  {s.same_day_conflicts.map((x, i) => (
                    <li key={i}>
                      {x.name}, {formatDate(x.date)}: saved <b>{x.kept}</b>, not saved <b>{x.dropped}</b>
                    </li>
                  ))}
                </ul>
                <p className="m-0 mt-1.5 text-[12.5px]">This list is shown once. The values that were not saved are not kept anywhere.</p>
              </>
            ) : (
              <p className="m-0 mt-1">Which ones was shown when the import was saved. To find them again, open the source file from the draw.</p>
            )}
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => navigate('/')}>
            View results
          </Button>
          <Button onClick={() => navigate('/import')}>Import more</Button>
        </div>
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/import" className="inline-flex items-center gap-1 text-[13px] text-ink-dim no-underline hover:text-ink">
            <Icon name="chevron-left" /> Imports
          </Link>
          <h1 className="m-0 font-display text-[26px] leading-[1.15] font-medium tracking-[-0.02em] sm:text-[30px]">Review import</h1>
          <p className="m-0 text-[13px] text-ink-dim">Check each row against the report. Unticked rows are left out. Rows already saved with the same value are unticked for you.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={confirmDiscard ? 'danger' : 'ghost'}
            title="Deletes the drafts and the uploaded files"
            onBlur={() => setConfirmDiscard(false)}
            onClick={() => {
              // Discarding deletes the uploads, so it takes a second press.
              if (!confirmDiscard) return setConfirmDiscard(true)
              void act.run(async () => {
                await api.post(`/subjects/${ds.subjectId}/imports/${batchId}/discard`)
                navigate('/import')
              })
            }}
          >
            {confirmDiscard ? 'Delete this import?' : 'Discard import'}
          </Button>
          {dirty.size ? <Button onClick={() => act.run(saveAll)}>Save draft</Button> : null}
          <Button
            variant="primary"
            busy={act.busy}
            disabled={pending || (!includedCount && !tagUpdates) || missingDates || unmapped}
            title={missingDates ? 'Set a collection date for every draw' : unmapped ? 'Map every row to a marker' : undefined}
            onClick={() =>
              act.run(async () => {
                await saveAll()
                setSummary(await api.post<CommitSummary>(`/subjects/${ds.subjectId}/imports/${batchId}/commit`))
                await ds.reload()
              })
            }
          >
            {!includedCount && tagUpdates ? `Save context for ${plural(tagUpdates, 'draw')}` : `Commit ${plural(includedCount, 'result')}${isShared ? ' as one draw' : ''}`}
          </Button>
        </div>
      </div>
      {/* Something that went wrong while saving is shown here, with the draft still on the page to fix. */}
      {act.error ? <Alert tone="error">{act.error}</Alert> : null}
      {missingDates ? <Alert tone="warn">{isShared ? 'Set the collection date in the draw details before committing.' : 'One or more draws has no collection date. Set it before committing.'}</Alert> : null}

      {canShare ? (
        <SharedDrawCard
          enabled={isShared}
          onToggle={(on) => setSharedMode(on)}
          value={shared}
          onChange={setSharedField}
          fileCount={readyIds.length}
          reportedDates={reportedDates}
        />
      ) : null}

      {live.map((c) => (
        <CandidateCard
          key={c.id}
          candidate={c}
          doc={docs[c.id] ?? null}
          options={options}
          markers={markers}
          subjectId={ds.subjectId}
          onChange={(fn) => update(c.id, fn)}
          onUseDate={(pi, date) =>
            isShared ? setSharedField('draw_date', date) : void act.run(() => updateAndSave(c.id, (d) => void (d.panels[pi].draw_date = date)))
          }
          shared={isShared ? shared : null}
          onRetry={() =>
            act.run(async () => {
              await api.post(`/subjects/${ds.subjectId}/imports/${batchId}/candidates/${c.id}/retry`)
              await load()
            })
          }
          onRemove={() =>
            act.run(async () => {
              const gone = await api.del<{ import_deleted: boolean }>(`/subjects/${ds.subjectId}/imports/${batchId}/candidates/${c.id}`)
              // Leaving out the last file leaves nothing to review.
              if (gone.import_deleted) navigate('/import')
              else await load()
            })
          }
          onMarkerCreated={() => void loadCatalog()}
        />
      ))}
    </div>
  )
}

function CandidateCard({
  candidate: c,
  doc,
  options,
  markers,
  subjectId,
  onChange,
  onUseDate,
  onRetry,
  onRemove,
  shared,
}: {
  candidate: Candidate
  doc: ExtractionDocument | null
  shared: DrawInfo | null
  options: { id: string; name: string; category: string }[]
  markers: Map<string, Marker>
  subjectId: string
  onChange: (fn: (d: ExtractionDocument) => void) => void
  onUseDate: (pi: number, date: string) => void
  onRetry: () => void
  onRemove: () => void
  onMarkerCreated: () => void
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Icon name={c.source_kind === 'manual' ? 'pencil' : 'file'} />
        <span className="font-semibold">{c.filename ?? 'Manual entry'}</span>
        <span className="text-[12px] text-ink-faint uppercase">{c.source_kind}</span>
        {c.model ? <span className="text-[12px] text-ink-faint">· read by {c.model.replace(/^@cf\//, '')}</span> : null}
        {c.privacy_mode === 'cloudflare_ai_redacted' ? <span className="text-[12px] text-ink-faint">· identifiers redacted</span> : null}
        <div className="ml-auto flex gap-1.5">
          {c.file_id ? (
            <a href={`/api/subjects/${subjectId}/files/${c.file_id}`} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-ink-dim no-underline hover:bg-sunken">
              <Icon name="external" /> Open file
            </a>
          ) : null}
          {c.status === 'ready' || c.status === 'failed' ? (
            <Button size="sm" variant="ghost" icon="x" onClick={onRemove} title={c.file_id ? 'Removes this file from the import and deletes the upload' : undefined}>
              Leave out
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 p-4">
        {c.status === 'queued' || c.status === 'processing' ? <Spinner label={c.status === 'queued' ? 'Waiting to be read…' : 'Reading the report… this can take a minute'} /> : null}
        {c.status === 'failed' ? (
          <Alert tone="error">
            {c.error ?? 'Extraction failed'}
            <div className="mt-2">
              <Button size="sm" icon="refresh" onClick={onRetry}>
                Try again
              </Button>
            </div>
          </Alert>
        ) : null}
        {doc?.document_warnings.map((w) => (
          <Alert key={w} tone="warn">
            {w}
          </Alert>
        ))}
        {c.status === 'ready' && doc
          ? doc.panels.map((_, pi) => (
              <PanelEditor
                key={pi}
                doc={doc}
                pi={pi}
                options={options}
                markers={markers}
                onChange={onChange}
                onUseDate={(date) => onUseDate(pi, date)}
                manual={c.source_kind === 'manual'}
                shared={shared}
              />
            ))
          : null}
        {c.status === 'ready' && doc && c.source_kind === 'manual' && !shared ? (
          <div>
            <Button size="sm" icon="plus" onClick={() => onChange((d) => d.panels.push({ draw_date: null, results: [], tags: [] }))}>
              Add another draw
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function PanelEditor({
  doc,
  pi,
  options,
  markers,
  onChange,
  onUseDate,
  manual,
  shared,
}: {
  doc: ExtractionDocument
  pi: number
  options: { id: string; name: string; category: string }[]
  markers: Map<string, Marker>
  onChange: (fn: (d: ExtractionDocument) => void) => void
  onUseDate: (date: string) => void
  manual: boolean
  shared: DrawInfo | null
}) {
  const p = doc.panels[pi]
  const set = (fn: (panel: ExtractionDocument['panels'][number]) => void) => onChange((d) => fn(d.panels[pi]))
  const setRow = (ri: number, fn: (r: ExtractedResult) => void) => set((panel) => fn(panel.results[ri]))
  const included = p.results.filter((r) => r.include !== false).length
  const kept = p.results.filter((r) => r.include === false && r.existing && !sameReportedValue(r.existing.raw_value, r.raw_value)).length
  const near = p.near_duplicate
  return (
    <div className="rounded-lg border border-line">
      {shared ? (
        <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line bg-elevated px-3 py-2 text-[12.5px] text-ink-dim">
          <span>
            Saved with the draw details above
            {shared.draw_date ? <b className="ml-1 text-ink">{formatDate(shared.draw_date)}</b> : null}
          </span>
          {p.collected_at || p.draw_date ? (
            <span className={cx('text-ink-faint', p.draw_date && shared.draw_date && p.draw_date !== shared.draw_date && 'text-warn')}>
              report shows {p.draw_date ? `${formatDate(p.draw_date)}${p.draw_time ? ` ${p.draw_time}` : ''}` : p.collected_at}
              {p.facility ? ` · ${p.facility}` : ''}
            </span>
          ) : null}
        </div>
      ) : (
      <div className="grid gap-3 border-b border-line bg-elevated px-3 py-2.5 sm:grid-cols-[150px_110px_1fr_1fr]">
        <Field label="Collection date">
          <input
            type="date"
            className={cx(inputClass, 'h-8 text-[13px]', !p.draw_date && 'border-high')}
            value={p.draw_date ?? ''}
            onChange={(e) => set((panel) => void (panel.draw_date = e.target.value || null))}
          />
        </Field>
        <Field label="Time">
          <input type="time" className={cx(inputClass, 'h-8 text-[13px]')} value={p.draw_time ?? ''} onChange={(e) => set((panel) => void (panel.draw_time = e.target.value || null))} />
        </Field>
        <Field label="Facility">
          <input className={cx(inputClass, 'h-8 text-[13px]')} value={p.facility ?? ''} onChange={(e) => set((panel) => void (panel.facility = e.target.value || null))} />
        </Field>
        <Field label="Context tags">
          <input
            className={cx(inputClass, 'h-8 text-[13px]')}
            placeholder="cycle day 3, fasting…"
            value={(p.tags ?? []).join(', ')}
            onChange={(e) => set((panel) => void (panel.tags = e.target.value.split(',').map((t) => t.trimStart())))}
            onBlur={() => set((panel) => void (panel.tags = (panel.tags ?? []).map((t) => t.trim()).filter(Boolean)))}
          />
        </Field>
      </div>
      )}
      {!shared && p.collected_at && parseLooseDate(p.collected_at)?.date !== p.draw_date ? (
        <div className="px-3 pt-2 text-[12px] text-ink-faint">Report shows: {p.collected_at}</div>
      ) : null}
      {p.warnings?.map((w) => (
        <div key={w} className="px-3 pt-2 text-[12.5px] text-warn">
          {w}
        </div>
      ))}
      {near ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pt-2 text-[12.5px]">
          <span className="text-warn">
            Same values as your {formatDate(near.draw_date)} draw for {near.matching === near.compared ? `all ${near.compared}` : `${near.matching} of the ${near.compared}`} tests both
            have, so this is probably that draw under another date. Use its date and nothing is saved twice.
          </span>
          <span className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => onUseDate(near.draw_date)}>
              Use {formatDate(near.draw_date, 'short')}
            </Button>
            <Link to={drawPath(near.panel_id)} target="_blank" className="text-[12.5px] text-ink-dim">
              Open that draw
            </Link>
          </span>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Include all"
                  checked={included === p.results.length && p.results.length > 0}
                  onChange={(e) => set((panel) => panel.results.forEach((r) => (r.include = e.target.checked)))}
                  className="accent-[var(--color-accent)]"
                />
              </th>
              <th className="px-2 py-2">As reported</th>
              <th className="px-2 py-2">Marker</th>
              <th className="px-2 py-2">Value</th>
              <th className="px-2 py-2">Units</th>
              <th className="px-2 py-2">Reference</th>
              <th className="px-2 py-2">Flag</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {p.results.map((r, ri) => (
              <ReviewRow key={ri} row={r} options={options} markers={markers} onChange={(fn) => setRow(ri, fn)} onDelete={() => set((panel) => void panel.results.splice(ri, 1))} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-[12.5px] text-ink-faint">
        <span>
          {included} of {plural(p.results.length, 'row')} included
          {kept ? ` · ${kept} ${kept === 1 ? 'differs' : 'differ'} from saved values and ${kept === 1 ? 'is' : 'are'} left out` : ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={() => set((panel) => void panel.results.push({ raw_name: '', raw_value: '', include: true, match: null, marker_id: null }))}
        >
          Add row
        </Button>
      </div>
      {manual && !p.results.length ? <div className="px-3 pb-3 text-[13px] text-ink-dim">Add a row for each result on the report.</div> : null}
    </div>
  )
}

function ReviewRow({
  row: r,
  options,
  markers,
  onChange,
  onDelete,
}: {
  row: ExtractedResult
  options: { id: string; name: string; category: string }[]
  markers: Map<string, Marker>
  onChange: (fn: (r: ExtractedResult) => void) => void
  onDelete: () => void
}) {
  const [picking, setPicking] = useState(false)
  const marker = r.marker_id ? markers.get(r.marker_id) : null
  const off = r.include === false
  const dupSame = r.existing && sameReportedValue(r.existing.raw_value, r.raw_value)
  const cell = cx(inputClass, 'h-7 px-1.5 text-[13px]')
  return (
    <tr className={cx('border-t border-line align-top', off && 'opacity-55')}>
      <td className="px-2 py-1.5">
        <input type="checkbox" checked={!off} onChange={(e) => onChange((x) => void (x.include = e.target.checked))} aria-label="Include row" className="mt-1.5 accent-[var(--color-accent)]" />
      </td>
      <td className="px-2 py-1.5">
        <input className={cx(cell, 'min-w-[150px]')} value={r.raw_name} onChange={(e) => onChange((x) => void (x.raw_name = e.target.value))} />
        {r.source_excerpt ? <div className="mt-0.5 max-w-[260px] truncate text-[11px] text-ink-faint" title={r.source_excerpt}>“{r.source_excerpt}”</div> : null}
        {r.confidence != null && r.confidence < 0.8 ? <div className="mt-0.5 text-[11px] text-warn">Low confidence: check against the report</div> : null}
        {r.warnings?.map((w) => (
          <div key={w} className="mt-0.5 text-[11px] text-warn">{w}</div>
        ))}
      </td>
      <td className="relative min-w-[210px] px-2 py-1.5">
        {picking ? (
          <MarkerPicker
            compact
            autoFocus
            options={options}
            allowCreate
            onPick={(id) => {
              onChange((x) => {
                x.marker_id = id
                x.match = 'manual'
                x.new_marker = null
              })
              setPicking(false)
            }}
            onCreate={(name) => {
              onChange((x) => {
                x.marker_id = null
                x.match = 'new'
                x.new_marker = { name, category: x.new_marker?.category ?? x.raw_test_category ?? 'uncategorized', default_units: x.raw_units ?? null }
              })
              setPicking(false)
            }}
          />
        ) : r.match === 'new' || (!marker && r.new_marker) ? (
          <div className="grid gap-1">
            <button type="button" onClick={() => setPicking(true)} className="text-left text-[13px]">
              <span className="rounded bg-warn-tint px-1 text-[11px] font-semibold text-warn uppercase">new</span> <b>{r.new_marker?.name ?? r.raw_name}</b>
            </button>
            <SelectField hideLabel size="sm" label="Category for new marker" value={r.new_marker?.category ?? 'uncategorized'}
              options={CATEGORIES.map(c => ({ value: c.slug, label: c.label, keywords: c.aliases.join(' ') }))}
              onChange={category => onChange(x => void (x.new_marker = { name: x.new_marker?.name ?? x.raw_name, default_units: x.raw_units ?? null, category }))} />
          </div>
        ) : marker ? (
          <button type="button" onClick={() => setPicking(true)} className="grid text-left text-[13px] hover:text-accent">
            <span className="font-medium">{marker.name}</span>
            <span className="text-[11px] text-ink-faint">
              {categoryLabel(marker.category)} · {r.match === 'manual' ? 'chosen by you' : r.match === 'alias' ? 'matched by name' : r.match === 'slug' ? 'matched' : r.match}
            </span>
          </button>
        ) : (
          <Button size="sm" onClick={() => setPicking(true)}>
            Choose marker
          </Button>
        )}
        {picking ? (
          <button type="button" onClick={() => setPicking(false)} className="mt-1 text-[11.5px] text-ink-faint hover:text-ink">
            cancel
          </button>
        ) : null}
      </td>
      <td className="px-2 py-1.5">
        <input className={cx(cell, 'w-24 font-semibold tabular')} value={r.raw_value} onChange={(e) => onChange((x) => void (x.raw_value = e.target.value))} />
        {r.existing ? (
          <div className={cx('mt-0.5 text-[11px]', dupSame ? 'text-ink-faint' : 'text-warn')}>
            {dupSame ? 'already saved' : off ? `saved: ${r.existing.raw_value} · tick to replace` : `saved: ${r.existing.raw_value} → will replace`}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-1.5">
        <input className={cx(cell, 'w-24')} value={r.raw_units ?? ''} onChange={(e) => onChange((x) => void (x.raw_units = e.target.value || null))} />
      </td>
      <td className="px-2 py-1.5">
        <input className={cx(cell, 'w-28')} value={r.reference_text ?? ''} onChange={(e) => onChange((x) => void (x.reference_text = e.target.value || null))} />
      </td>
      <td className="px-2 py-1.5">
        <SelectField hideLabel size="sm" className="w-28" label="Flag" value={r.lab_flag ?? ''}
          options={[{ value: '', label: '—' }, ...['low', 'high', 'critical', 'abnormal'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} onChange={flag => onChange(x => void (x.lab_flag = flag || null))} />
      </td>
      <td className="px-1 py-1.5">
        <button type="button" aria-label="Delete row" onClick={onDelete} className="rounded p-1 text-ink-faint hover:bg-sunken hover:text-ink">
          <Icon name="trash" />
        </button>
      </td>
    </tr>
  )
}

function SharedDrawCard({
  enabled,
  onToggle,
  value,
  onChange,
  fileCount,
  reportedDates,
}: {
  enabled: boolean
  onToggle: (on: boolean) => void
  value: DrawInfo
  onChange: <K extends keyof DrawInfo>(k: K, v: DrawInfo[K]) => void
  fileCount: number
  reportedDates: string[]
}) {
  const [tagText, setTagText] = useState(value.tags.join(', '))
  useEffect(() => setTagText(value.tags.join(', ')), [value.tags])
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-[15px] font-semibold">Draw details</h2>
          <p className="m-0 text-[12.5px] text-ink-dim">
            {enabled
              ? `Set once for all ${plural(fileCount, 'file')}; they are saved as one draw.`
              : 'Each file keeps its own collection date and details below.'}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          Treat all files as one draw
        </label>
      </div>
      {enabled ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-[160px_120px_1fr_1fr]">
            <Field label="Collection date">
              <input type="date" className={cx(inputClass, !value.draw_date && 'border-high')} value={value.draw_date ?? ''} onChange={(e) => onChange('draw_date', e.target.value || null)} />
            </Field>
            <Field label="Time">
              <input type="time" className={inputClass} value={value.draw_time ?? ''} onChange={(e) => onChange('draw_time', e.target.value || null)} />
            </Field>
            <Field label="Facility">
              <input className={inputClass} value={value.facility ?? ''} onChange={(e) => onChange('facility', e.target.value || null)} />
            </Field>
            <Field label="Context tags">
              <input
                className={inputClass}
                placeholder="cycle day 3, fasting…"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                onBlur={() => onChange('tags', tagText.split(',').map((t) => t.trim()).filter(Boolean))}
              />
            </Field>
          </div>
          {reportedDates.length > 1 ? (
            <div className="mt-2">
              <Alert tone="warn">
                The files report different collection dates ({reportedDates.map((d) => formatDate(d)).join(', ')}). Every result will be saved on the date above. Untick “Treat all files as one draw” to keep them separate.
              </Alert>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}
