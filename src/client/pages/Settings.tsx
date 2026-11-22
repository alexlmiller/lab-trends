import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { categoryLabel } from '../../shared/categories'
import type { Instance } from '../../shared/types'
import { Icon } from '../components/Icon'
import { Alert, Button, Card, CopyRow, Field, inputClass, linkClass, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useData, useDataset } from '../lib/data'
import { plural } from '../lib/format'

export function SettingsPage() {
  const { me, setSubjectId, subjectId, catalog, loadCatalog } = useData()
  const ds = useDataset()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [rename, setRename] = useState(ds.subject.display_name)
  const [error, setError] = useState<string | null>(null)

  const exportCsv = () => {
    const head = ['test_name', 'category', 'drawn_at', 'raw_value', 'raw_units', 'reference_range', 'flag', 'facility', 'notes']
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [head.join(',')]
    for (const m of ds.markers)
      for (const r of m.results)
        lines.push([m.name, categoryLabel(m.category), r.draw_date, r.raw_value, r.raw_units, r.reference_text, r.lab_flag, r.facility, r.notes].map(esc).join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lab-results-${ds.subject.display_name.toLowerCase().replace(/\W+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
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
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api.patch(`/subjects/${ds.subjectId}`, { display_name: rename })
              window.location.reload()
            } catch (err) {
              setError((err as Error).message)
            }
          }}
        >
          <Field label={`Rename ${ds.subject.display_name}`}>
            <input className={inputClass} value={rename} onChange={(e) => setRename(e.target.value)} />
          </Field>
          <Button type="submit">Rename</Button>
        </form>
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              const s = await api.post<{ id: string }>('/subjects', { display_name: name })
              setSubjectId(s.id)
              window.location.assign('/')
            } catch (err) {
              setError((err as Error).message)
            }
          }}
        >
          <Field label="Add another person">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </Field>
          <Button type="submit" disabled={!name.trim()}>
            Add
          </Button>
        </form>
        {error ? <div className="mt-2"><Alert tone="error">{error}</Alert></div> : null}
      </Card>

      <Card>
        <h2 className="m-0 mb-2 text-[15px] font-semibold">Data</h2>
        <div className="grid gap-2 text-[13.5px]">
          <div className="flex items-center justify-between gap-2">
            <span>
              {plural(ds.markers.reduce((n, m) => n + m.results.length, 0), 'result')} across {plural(ds.panels.length, 'draw')}
            </span>
            <Button size="sm" icon="file" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Tests, names and duplicates</span>
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

      {ds.preferences.hidden_marker_ids.length ? (
        <HiddenMarkers ids={ds.preferences.hidden_marker_ids} names={catalog} loadNames={loadCatalog} />
      ) : null}

      <McpSetup />
    </div>
  )
}

function HiddenMarkers({ ids, names, loadNames }: { ids: string[]; names: { id: string; name: string }[] | null; loadNames: () => Promise<unknown> }) {
  const ds = useDataset()
  useEffect(() => {
    if (!names) void loadNames()
  }, [names, loadNames])
  const nameOf = (id: string) => names?.find((m) => m.id === id)?.name ?? id
  return (
    <Card>
      <h2 className="m-0 mb-1 text-[15px] font-semibold">Removed tests</h2>
      <p className="m-0 mb-2 text-[12.5px] text-ink-dim">Rows for these arrive unticked when you import. Allow one again to have it imported normally.</p>
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-2 py-1 text-[13.5px]">
          <span className="flex-1">{nameOf(id)}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await api.put(`/subjects/${ds.subjectId}/preferences`, { hidden_marker_ids: ids.filter((x) => x !== id) })
              await ds.reload()
            }}
          >
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      api
        .get<Instance>('/instance')
        .then(setInstance)
        .catch((e: Error) => setError(e.message)),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])
  const change = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const row = 'flex min-h-8 items-center gap-2 text-[13.5px]'
  const tag = 'text-[12px] text-ink-faint'
  return (
    <Card>
      <h2 className="m-0 text-[15px] font-semibold">People with access</h2>
      <p className="m-0 mt-1 mb-3 text-[13px] text-ink-dim">Everyone here can see and change every person’s results.</p>
      {instance ? (
        <div className="grid gap-0.5">
          <div className={row}>
            <Icon name="user" className="text-ink-faint" />
            <span className="min-w-0 truncate">{instance.owner_email}</span>
            <span className={tag}>owner{instance.owner_email === email ? ', you' : ''}</span>
          </div>
          {instance.people.map((p) => (
            <div key={p.email} className={row}>
              <Icon name="user" className="text-ink-faint" />
              <span className="min-w-0 truncate">{p.email}</span>
              {p.email === email ? <span className={tag}>you</span> : null}
              {owner ? (
                <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => change(() => api.del(`/instance/people/${encodeURIComponent(p.email)}`))}>
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
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
        {owner ? 'Adding someone here is half of it: also allow their address in Cloudflare (Zero Trust, Access controls, Policies), or Cloudflare stops them at the sign-in page. ' : 'Only the owner can change this list. '}
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
        <li>Everything it changes is recorded with “(via MCP)” in the revision history, and it asks before saving drafted results.</li>
        <li>Other MCP clients that support OAuth can connect too; their sign-in callback may need to be allowed in Cloudflare Access first.</li>
      </ul>
    </Card>
  )
}
