import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { categoryLabel } from '../../shared/categories'
import { formatDate, todayDate } from '../../shared/dates'
import type { Instance } from '../../shared/types'
import { Icon } from '../components/Icon'
import { Alert, Button, ButtonAnchor, Card, CopyRow, Field, inputClass, linkClass, Modal, PageHeader } from '../components/ui'
import { useAction } from '../lib/action'
import { api } from '../lib/api'
import { useData, useDataset, useSavePreferences } from '../lib/data'
import { plural } from '../lib/format'

/** Save text as a file from the browser. The name carries the date, never the person's name. */
function download(name: string, extension: 'csv' | 'json', content: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/json' }))
  a.download = `${name}-${todayDate()}.${extension}`
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * One CSV cell. A spreadsheet runs a cell that starts with = + - or @ as a
 * formula, and test names and notes can come from an uploaded document, so
 * anything like that except a plain number is made literal with a quote mark.
 */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(?:\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function SettingsPage() {
  const { me, setSubjectId, subjectId, catalog, loadCatalog } = useData()
  const ds = useDataset()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [rename, setRename] = useState(ds.subject.display_name)
  const [deleting, setDeleting] = useState(false)
  const people = useAction()

  const exportCsv = () => {
    const draws = new Map(ds.panels.map((p) => [p.id, p]))
    const lines = [['test_name', 'category', 'drawn_at', 'raw_value', 'raw_units', 'reference_range', 'flag', 'facility', 'notes', 'draw_tags', 'draw_notes'].join(',')]
    for (const m of ds.markers) {
      for (const r of m.results) {
        const when = r.draw_time ? `${r.draw_date}T${r.draw_time}` : r.draw_date
        lines.push([m.name, categoryLabel(m.category), when, r.raw_value, r.raw_units, r.reference_text, r.lab_flag, r.facility, r.notes, r.panel_tags.join('; '), draws.get(r.panel_id)?.notes].map(csvCell).join(','))
      }
    }
    download('lab-results', 'csv', lines.join('\n'))
  }
  // Everything on file for this person except the uploaded reports themselves: results, draws, events, targets and views.
  const exportAll = () => {
    const { subject, markers, panels, events, preferences, saved_views } = ds
    download('lab-trends-export', 'json', JSON.stringify({ exported_at: new Date().toISOString(), subject, markers, panels, events, preferences, saved_views }, null, 2))
  }

  return (
    <div className="grid max-w-2xl gap-4">
      <PageHeader title="Settings" />
      <AccessCard email={me?.email ?? ''} owner={Boolean(me?.owner)} />

      <Card>
        <h2 className="m-0 mb-3 text-[15px] font-semibold">Whose results</h2>
        <div className="grid gap-1.5">
          {me?.subjects.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-[13.5px]">
              <Icon name="user" className="text-ink-faint" />
              <span className={s.id === subjectId ? 'font-semibold' : ''}>{s.display_name}</span>
              {s.id !== subjectId ? (
                <Button size="sm" variant="ghost" onClick={() => setSubjectId(s.id)}>
                  Switch
                </Button>
              ) : (
                <span className="text-[12px] text-ink-faint">viewing</span>
              )}
            </div>
          ))}
        </div>
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void people.run(async () => {
              await api.patch(`/subjects/${ds.subjectId}`, { display_name: rename })
              window.location.reload()
            })
          }}
        >
          <Field label={`Rename ${ds.subject.display_name}`}>
            <input className={inputClass} value={rename} onChange={(e) => setRename(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!rename.trim() || people.busy}>
            Rename
          </Button>
        </form>
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void people.run(async () => {
              const s = await api.post<{ id: string }>('/subjects', { display_name: name })
              setSubjectId(s.id)
              window.location.assign('/')
            })
          }}
        >
          <Field label="Add another person">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </Field>
          <Button type="submit" disabled={!name.trim() || people.busy}>
            Add
          </Button>
        </form>
        {people.error ? <div className="mt-2"><Alert tone="error">{people.error}</Alert></div> : null}
        {me?.owner ? (
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-[13.5px]">
            <span className="text-ink-dim">Remove {ds.subject.display_name} and everything recorded about them</span>
            <Button size="sm" variant="danger" icon="trash" onClick={() => setDeleting(true)}>
              Delete person
            </Button>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="m-0 mb-2 text-[15px] font-semibold">Data</h2>
        <div className="grid gap-2 text-[13.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {plural(ds.markers.reduce((n, m) => n + m.results.length, 0), 'result')} across {plural(ds.panels.length, 'draw')}
            </span>
            <span className="flex gap-2">
              <Button size="sm" icon="file" onClick={exportCsv} title="Results, one row each, for a spreadsheet">
                Export CSV
              </Button>
              <Button size="sm" icon="file" onClick={exportAll} title="Results, draws, events, targets and saved views">
                Export everything
              </Button>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Markers, names and duplicates</span>
            <Button size="sm" onClick={() => navigate('/catalog')}>
              Manage markers
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Imports and source files</span>
            <Link to="/import" className="text-[13px]">
              View imports →
            </Link>
          </div>
        </div>
      </Card>

      <LooseFiles />

      {ds.preferences.hidden_marker_ids.length ? (
        <HiddenMarkers ids={ds.preferences.hidden_marker_ids} names={catalog} loadNames={loadCatalog} />
      ) : null}

      <McpSetup />
      {deleting ? <DeletePerson name={ds.subject.display_name} subjectId={ds.subjectId} onClose={() => setDeleting(false)} /> : null}
    </div>
  )
}

/** Deleting a person cannot be undone, so their name has to be typed. */
function DeletePerson({ name, subjectId, onClose }: { name: string; subjectId: string; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const { busy, error, run } = useAction()
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase()
  return (
    <Modal
      title={`Delete ${name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            busy={busy}
            disabled={!matches}
            onClick={() =>
              run(async () => {
                await api.del(`/subjects/${subjectId}?confirm=${encodeURIComponent(typed.trim())}`)
                window.location.assign('/')
              })
            }
          >
            Delete everything
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-[13.5px]">
        <p className="m-0">
          This deletes every draw, result, uploaded report, import, event, target and saved view recorded for {name}. It cannot be undone, and nothing is kept.
        </p>
        <Field label={`Type ${name} to confirm`}>
          <input className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-autofocus />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Modal>
  )
}

type LooseFile = { id: string; filename: string; byte_size: number | null; created_at: string }

/**
 * Uploads that are stored but that no draw shows. Imports saved before every
 * source was linked to its draw could leave these behind; they are listed so
 * nothing is kept out of sight.
 */
function LooseFiles() {
  const ds = useDataset()
  const [files, setFiles] = useState<LooseFile[]>([])
  const { busy, error, run } = useAction()
  const load = useCallback(() => api.get<LooseFile[]>(`/subjects/${ds.subjectId}/files`).then(setFiles), [ds.subjectId])
  useEffect(() => {
    void load().catch(() => setFiles([]))
  }, [load])
  if (!files.length) return null
  return (
    <Card>
      <h2 className="m-0 mb-1 text-[15px] font-semibold">Uploads not shown on any draw</h2>
      <p className="m-0 mb-2 text-[12.5px] text-ink-dim">These reports are still stored, but no draw links to them. Open one to check it, or delete it.</p>
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-2 py-1 text-[13.5px]">
          <span className="min-w-0 flex-1 truncate">{f.filename}</span>
          <span className="shrink-0 text-[12px] text-ink-faint">{formatDate(f.created_at.slice(0, 10))}</span>
          <ButtonAnchor size="sm" variant="ghost" icon="external" href={`/api/subjects/${encodeURIComponent(ds.subjectId)}/files/${encodeURIComponent(f.id)}`}>
            Open
          </ButtonAnchor>
          <Button size="sm" variant="ghost" icon="trash" disabled={busy} onClick={() => run(async () => { await api.del(`/subjects/${ds.subjectId}/files/${f.id}`); await load() })}>
            Delete
          </Button>
        </div>
      ))}
      {error ? <div className="mt-2"><Alert tone="error">{error}</Alert></div> : null}
    </Card>
  )
}

function HiddenMarkers({ ids, names, loadNames }: { ids: string[]; names: { id: string; name: string }[] | null; loadNames: () => Promise<unknown> }) {
  const save = useSavePreferences()
  useEffect(() => {
    if (!names) void loadNames()
  }, [names, loadNames])
  const nameOf = (id: string) => names?.find((m) => m.id === id)?.name ?? id
  return (
    <Card>
      <h2 className="m-0 mb-1 text-[15px] font-semibold">Removed markers</h2>
      <p className="m-0 mb-2 text-[12.5px] text-ink-dim">Rows for these arrive unticked when you import. Allow one again to have it imported normally.</p>
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-2 py-1 text-[13.5px]">
          <span className="flex-1">{nameOf(id)}</span>
          <Button size="sm" variant="ghost" onClick={() => save({ hidden_marker_ids: ids.filter((x) => x !== id) })}>
            Allow again
          </Button>
        </div>
      ))}
    </Card>
  )
}

/** Who can sign in. The owner manages the list; Cloudflare Access does the signing in. */
function AccessCard({ email, owner }: { email: string; owner: boolean }) {
  const [instance, setInstance] = useState<Instance | null>(null)
  const [adding, setAdding] = useState('')
  const { busy, error, run, setError } = useAction()
  const load = useCallback(
    () =>
      api
        .get<Instance>('/instance')
        .then(setInstance)
        .catch((e: Error) => setError(e.message)),
    [setError],
  )
  useEffect(() => {
    void load()
  }, [load])
  const change = (work: () => Promise<unknown>) =>
    run(async () => {
      await work()
      await load()
    })
  const row = 'flex min-h-8 items-center gap-2 text-[13.5px]'
  const tag = 'text-[12px] text-ink-faint'
  return (
    <Card>
      <h2 className="m-0 text-[15px] font-semibold">People with access</h2>
      <p className="m-0 mt-1 mb-3 text-[13px] text-ink-dim">Everyone with access can see and change every person’s results.</p>
      {instance ? (
        <div className="grid gap-0.5">
          <div className={row}>
            <Icon name="user" className="text-ink-faint" />
            <span className="min-w-0 truncate">{instance.owner_email}</span>
            <span className={tag}>owner{instance.owner_email === email ? ', you' : ''}</span>
          </div>
          {owner ? (
            instance.people.map((p) => (
              <div key={p.email} className={row}>
                <Icon name="user" className="text-ink-faint" />
                <span className="min-w-0 truncate">{p.email}</span>
                <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => change(() => api.del(`/instance/people/${encodeURIComponent(p.email)}`))}>
                  Remove
                </Button>
              </div>
            ))
          ) : instance.owner_email !== email ? (
            <div className={row}>
              <Icon name="user" className="text-ink-faint" />
              <span className="min-w-0 truncate">{email}</span>
              <span className={tag}>you</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {owner ? (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void change(async () => {
              await api.post('/instance/people', { email: adding })
              setAdding('')
            })
          }}
        >
          <Field label="Add someone by email">
            <input className={inputClass} type="email" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="name@example.com" autoComplete="off" />
          </Field>
          <Button type="submit" busy={busy} disabled={!adding.trim()}>
            Add
          </Button>
        </form>
      ) : null}
      {error ? <div className="mt-2"><Alert tone="error">{error}</Alert></div> : null}
      <p className="m-0 mt-3 text-[12.5px] text-ink-faint">
        {owner
          ? 'Adding someone here is half of it: also allow their address in Cloudflare (Zero Trust, Access controls, Policies), or Cloudflare stops them at the sign-in page. '
          : 'Only the owner can change who has access, and only the owner sees the full list. '}
        Sign-in is Cloudflare Access{instance?.access ? ` (${instance.access.team_domain})` : ''}.{' '}
        <a className={linkClass} href="/cdn-cgi/access/logout">
          Sign out
        </a>
      </p>
    </Card>
  )
}

/** How to connect an AI assistant to this record over MCP. */
function McpSetup() {
  const url = `${window.location.origin}/mcp`
  const command = `claude mcp add --transport http lab-trends ${url}`
  return (
    <Card className="grid gap-4">
      <div>
        <h2 className="m-0 text-[15px] font-semibold">Connect an AI assistant (MCP)</h2>
        <p className="m-0 mt-1 text-[13px] text-ink-dim">
          Give an assistant such as Claude direct access to these results and the timeline. It can review new draws, follow your watched tests, compare results before and after a treatment, record medications, illnesses and other events as you mention them, annotate draws, and draft new results for you to confirm before they are saved.
        </p>
      </div>
      <CopyRow label="Server URL" value={url} />
      <div className="grid gap-2 text-[13px]">
        <div className="font-medium text-ink">Claude (web, desktop or mobile)</div>
        <p className="m-0 text-ink-dim">
          Settings → Connectors → Add custom connector. Name it Lab Trends and paste the server URL above.
        </p>
        <div className="font-medium text-ink">Claude Code</div>
        <CopyRow value={command} mono />
      </div>
      <ul className="m-0 grid list-disc gap-1 pl-4 text-[12.5px] text-ink-dim">
        <li>The assistant opens the usual Lab Trends sign-in, so only people with access can connect. This needs managed OAuth turned on for the Access application in Cloudflare.</li>
        <li>Whatever the assistant reads is sent to the company that runs it.</li>
        <li>It asks before saving drafted results. What it saves or changes is recorded under your address with “(via MCP)”, and it can delete results and events for good.</li>
        <li>Other MCP clients that support OAuth can connect too; their sign-in callback may need to be allowed in Cloudflare Access first.</li>
      </ul>
    </Card>
  )
}
