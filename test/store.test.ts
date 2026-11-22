// The API end to end against a real SQLite database with the real migrations:
// importing, saving, the dataset the charts read, deleting, and bringing rows
// stored under older rules up to date.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeAlias } from '../src/shared/markers'
import type { CommitSummary, Dataset, ImportBatch } from '../src/shared/types'
import { forgetCatalog, loadCatalog } from '../src/worker/catalog'
import worker from '../src/worker/index'
import { markerIndex } from '../src/worker/resolve'
import { DATA_VERSION, forgetUpgrade, upgradeData } from '../src/worker/upgrade'
import { testDatabase, testEnv } from './helpers'

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function client(env: Env) {
  return async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> => {
    const init: RequestInit = { method, headers }
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) {
      init.body = JSON.stringify(body)
      init.headers = { ...headers, 'Content-Type': 'application/json' }
    }
    const res = await worker.fetch(new Request(`http://localhost/api${path}`, init), env, ctx)
    return { status: res.status, body: (await res.json()) as T }
  }
}

const csv = (name: string, text: string) => {
  const form = new FormData()
  form.append('files', new File([text], name, { type: 'text/csv' }))
  return form
}

async function setup() {
  forgetCatalog()
  forgetUpgrade()
  const t = testEnv()
  const api = client(t.env)
  const sid = (await api<{ id: string }>('POST', '/subjects', { display_name: 'Sample Person' })).body.id
  const upload = async (name: string, text: string) => (await api<ImportBatch>('POST', `/subjects/${sid}/imports`, csv(name, text))).body
  const save = async (name: string, text: string) => {
    const batch = await upload(name, text)
    return (await api<CommitSummary>('POST', `/subjects/${sid}/imports/${batch.id}/commit`)).body
  }
  const dataset = async () => (await api<Dataset>('GET', `/subjects/${sid}/dataset`)).body
  const count = (table: string) => Number(t.DB.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0].n)
  return { ...t, api, sid, upload, save, dataset, count }
}

const CBC = 'Test,Value,Units,Range,Date\nGlucose,90,mg/dL,70-99,2025-03-04\nSodium,150,mmol/L,135-145,2025-03-04\n'

describe('importing and saving', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
  })

  it('reads a CSV, saves it, and shows it with its source report', async () => {
    const batch = await s.upload('march.csv', CBC)
    expect(batch.candidates.map((c) => c.status)).toEqual(['ready'])
    const summary = (await s.api<CommitSummary>('POST', `/subjects/${s.sid}/imports/${batch.id}/commit`)).body
    expect(summary).toMatchObject({ panels_created: 1, results_created: 2 })
    const ds = await s.dataset()
    expect(ds.panels).toHaveLength(1)
    expect(ds.panels[0]).toMatchObject({ draw_date: '2025-03-04', result_count: 2, flagged_count: 1, sources: [{ filename: 'march.csv' }] })
    expect(ds.markers.map((m) => [m.name, m.results[0].raw_value, m.results[0].lab_flag]).sort()).toEqual([['Glucose', '90', null], ['Sodium', '150', 'high']])
    // The draft was a second copy of the results; saving drops it.
    expect(s.DB.query('SELECT document FROM extraction_candidates')[0].document).toBeNull()
  })

  it('saves an import once, however many times it is asked to', async () => {
    const batch = await s.upload('march.csv', CBC)
    const commits = await Promise.all([1, 2, 3].map(() => s.api('POST', `/subjects/${s.sid}/imports/${batch.id}/commit`)))
    expect(commits.map((c) => c.status).sort()).toEqual([200, 409, 409])
    expect(s.count('lab_panels')).toBe(1)
    expect(s.count('lab_results')).toBe(2)
  })

  it('opens an import again when saving it fails', async () => {
    const batch = await s.upload('march.csv', CBC)
    const candidate = batch.candidates[0].id
    const doc = (await s.api<ImportBatch>('GET', `/subjects/${s.sid}/imports/${batch.id}`)).body.candidates[0].document!
    doc.panels[0].draw_date = '2025-02-30'
    await s.api('PUT', `/subjects/${s.sid}/imports/${batch.id}/candidates/${candidate}`, { document: doc })
    expect((await s.api('POST', `/subjects/${s.sid}/imports/${batch.id}/commit`)).status).toBe(400)
    expect(s.DB.query('SELECT status FROM import_batches')[0].status).toBe('open')
    expect(s.count('lab_results')).toBe(0)
  })

  it('never overwrites one value with another from the same import without saying so', async () => {
    const summary = await s.save('ogtt.csv', 'Test,Value,Date\nGlucose,90,2025-03-04\nGlucose,160,2025-03-04\nGlucose,90.0,2025-03-04\n')
    expect(summary).toMatchObject({ results_created: 1, duplicates_skipped: 1, same_day_conflict_count: 1, same_day_conflicts: [{ date: '2025-03-04', name: 'Glucose', kept: '90', dropped: '160' }] })
    expect(s.DB.query('SELECT raw_value FROM lab_results').map((r) => r.raw_value)).toEqual(['90'])
    // The value that was not saved is in the reply only: the import's record keeps the count.
    const stored = String(s.DB.query('SELECT summary FROM import_batches')[0].summary)
    expect(JSON.parse(stored)).toMatchObject({ same_day_conflict_count: 1 })
    expect(stored).not.toContain('160')
  })

  it('tells the reviewer about a repeated test before it is saved', async () => {
    const batch = await s.upload('ogtt.csv', 'Test,Value,Date\nGlucose,90,2025-03-04\nGlucose,160,2025-03-04\n')
    const rows = (await s.api<ImportBatch>('GET', `/subjects/${s.sid}/imports/${batch.id}`)).body.candidates[0].document!.panels[0].results
    expect(rows[0].warnings ?? []).toEqual([])
    expect(rows[1].warnings?.join(' ')).toMatch(/Also listed as 90 on this date/)
  })

  it('keeps tests apart that differ by # and %, or are written in another script', async () => {
    await s.save('cbc.csv', 'Test,Value,Units,Date\nNeutrophils %,55,%,2025-03-04\nNeutrophils #,3.1,x10E3/uL,2025-03-04\nГлюкоза,5.4,ммоль/л,2025-03-04\nГемоглобин,140,г/л,2025-03-04\n')
    const ds = await s.dataset()
    expect(ds.markers.map((m) => [m.name, m.results[0].raw_value]).sort()).toEqual([
      ['Neutrophil %', '55'],
      ['Neutrophil count', '3.1'],
      ['Гемоглобин', '140'],
      ['Глюкоза', '5.4'],
    ])
    // A name with no ASCII letters gets a slug no other name can produce.
    expect(ds.markers.map((m) => m.slug).filter((slug) => !slug.startsWith('neutrophils-')).every((slug) => /^m-[0-9a-f]{20}$/.test(slug))).toBe(true)
    // The same names resolve to the same tests next time, and a bare name goes by its units.
    await s.save('next.csv', 'Test,Value,Units,Date\nГлюкоза,5.9,,2025-06-04\nNeutrophils #,2.8,,2025-06-04\nNeutrophils,3.3,x10E3/uL,2025-09-04\nNeutrophils,61,%,2025-09-04\n')
    expect((await s.dataset()).markers.map((m) => [m.name, m.results.length]).sort()).toEqual([['Neutrophil %', 2], ['Neutrophil count', 3], ['Гемоглобин', 1], ['Глюкоза', 2]])
  })

  it('does not make the same new test twice when two imports both proposed it', async () => {
    const [a, b] = [await s.upload('a.csv', 'Test,Value,Date\nBrand New Test,1,2025-03-04\n'), await s.upload('b.csv', 'Test,Value,Date\nBrand New Test,2,2025-04-04\n')]
    for (const batch of [a, b]) await s.api('POST', `/subjects/${s.sid}/imports/${batch.id}/commit`)
    expect(s.DB.query("SELECT slug FROM lab_markers WHERE name = 'Brand New Test'").map((m) => m.slug)).toEqual(['brand-new-test'])
    expect((await s.dataset()).markers.map((m) => [m.name, m.results.length])).toEqual([['Brand New Test', 2]])
  })

  it('replaces a saved value only when the row is ticked, and keeps the old one as a revision', async () => {
    await s.save('a.csv', CBC)
    const batch = await s.upload('b.csv', 'Test,Value,Date\nGlucose,95,2025-03-04\nSodium,150,2025-03-04\n')
    const path = `/subjects/${s.sid}/imports/${batch.id}`
    const candidate = (await s.api<ImportBatch>('GET', path)).body.candidates[0]
    // Both rows line up with saved results, so both arrive unticked; nothing is left to save.
    expect(candidate.document!.panels[0].results.map((r) => r.include)).toEqual([false, false])
    candidate.document!.panels[0].results[0].include = true
    const saved = (await s.api<{ document: typeof candidate.document }>('PUT', `${path}/candidates/${candidate.id}`, { document: candidate.document })).body
    expect(saved.document!.panels[0].results[0].include).toBe(true)
    expect((await s.api<CommitSummary>('POST', `${path}/commit`)).body).toMatchObject({ results_replaced: 1, results_created: 0 })
    expect(s.DB.query("SELECT raw_value FROM lab_results WHERE raw_name = 'Glucose'")[0].raw_value).toBe('95')
    const revision = s.DB.query<{ action: string; before_json: string }>('SELECT action, before_json FROM result_revisions')[0]
    expect(revision.action).toBe('import_replace')
    expect(JSON.parse(revision.before_json).raw_value).toBe('90')
    // The second upload put a result on the draw, so it is a source of it too; had it added nothing it would be gone.
    expect((await s.dataset()).panels[0].sources.map((x) => x.filename).sort()).toEqual(['a.csv', 'b.csv'])
  })

  it('deletes an upload that added nothing', async () => {
    await s.save('a.csv', CBC)
    await s.upload('again.csv', CBC)
    expect(s.FILES.objects.size).toBe(2)
    const open = s.DB.query<{ id: string }>("SELECT id FROM import_batches WHERE status = 'open'")[0].id
    // Every row is already saved, so there is nothing to commit; discarding removes the upload.
    expect((await s.api('POST', `/subjects/${s.sid}/imports/${open}/commit`)).status).toBe(200)
    expect(s.FILES.objects.size).toBe(1)
    expect(s.count('files')).toBe(1)
  })

  it('refuses uploads beyond its limits, and unreadable files without losing the import', async () => {
    const many = new FormData()
    for (let i = 0; i < 21; i++) many.append('files', new File(['Test,Value,Date\n'], `f${i}.csv`))
    expect((await s.api('POST', `/subjects/${s.sid}/imports`, many)).status).toBe(400)
    expect((await s.api('POST', `/subjects/${s.sid}/imports`, csv('a.csv', CBC), { 'Content-Length': String(65 * 1024 * 1024) })).status).toBe(413)
    const broken = new FormData()
    broken.append('files', new File(['not a workbook'], 'broken.xlsx'))
    const batch = (await s.api<ImportBatch>('POST', `/subjects/${s.sid}/imports`, broken)).body
    expect(batch.candidates[0]).toMatchObject({ status: 'failed' })
    expect(String(batch.candidates[0].error)).toMatch(/not a ZIP archive/)
  })

  it('gives up on a file that never finishes being read', async () => {
    const batch = await s.upload('march.csv', CBC)
    s.DB.query("UPDATE extraction_candidates SET status = 'processing', updated_at = '2020-01-01T00:00:00.000Z'")
    const after = (await s.api<ImportBatch>('GET', `/subjects/${s.sid}/imports/${batch.id}?brief=1`)).body
    expect(after.candidates[0]).toMatchObject({ status: 'failed', document: null })
    expect(String(after.candidates[0].error)).toMatch(/did not finish/)
    // Trying again reads the stored upload.
    expect((await s.api('POST', `/subjects/${s.sid}/imports/${batch.id}/candidates/${batch.candidates[0].id}/retry`)).status).toBe(200)
    expect((await s.api<ImportBatch>('GET', `/subjects/${s.sid}/imports/${batch.id}`)).body.candidates[0].status).toBe('ready')
  })
})

describe('deleting', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
  })

  it('deletes a discarded import, drafts and uploads included', async () => {
    const batch = await s.upload('march.csv', CBC)
    expect(s.FILES.objects.size).toBe(1)
    expect((await s.api('POST', `/subjects/${s.sid}/imports/${batch.id}/discard`)).status).toBe(200)
    for (const table of ['import_batches', 'extraction_candidates', 'files']) expect(s.count(table), table).toBe(0)
    expect(s.FILES.objects.size).toBe(0)
  })

  it('deletes a file left out of an import, and the import with its last file', async () => {
    const form = csv('a.csv', CBC)
    form.append('files', new File([CBC], 'b.csv', { type: 'text/csv' }))
    const batch = (await s.api<ImportBatch>('POST', `/subjects/${s.sid}/imports`, form)).body
    const [a, b] = batch.candidates
    expect((await s.api('DELETE', `/subjects/${s.sid}/imports/${batch.id}/candidates/${a.id}`)).body).toMatchObject({ import_deleted: false })
    expect([...s.FILES.objects.keys()].map((k) => k.split('/').pop())).toEqual(['b.csv'])
    expect((await s.api('DELETE', `/subjects/${s.sid}/imports/${batch.id}/candidates/${b.id}`)).body).toMatchObject({ import_deleted: true })
    expect(s.count('import_batches') + s.count('files') + s.FILES.objects.size).toBe(0)
  })

  it('deletes a draw with its results, their old versions and its report', async () => {
    await s.save('march.csv', CBC)
    const ds = await s.dataset()
    const glucose = ds.markers.find((m) => m.name === 'Glucose')!.results[0]
    await s.api('PATCH', `/subjects/${s.sid}/results/${glucose.id}`, { raw_value: '91' })
    expect(s.count('result_revisions')).toBe(1)
    expect((await s.api('DELETE', `/subjects/${s.sid}/panels/${ds.panels[0].id}`)).status).toBe(200)
    for (const table of ['lab_panels', 'lab_results', 'result_revisions', 'panel_files', 'files']) expect(s.count(table), table).toBe(0)
    expect(s.FILES.objects.size).toBe(0)
    expect((await s.dataset()).markers).toEqual([])
  })

  it('keeps a report that another draw still uses', async () => {
    await s.save('two.csv', 'Test,Value,Date\nGlucose,90,2025-03-04\nGlucose,95,2025-06-04\n')
    const ds = await s.dataset()
    await s.api('DELETE', `/subjects/${s.sid}/panels/${ds.panels[0].id}`)
    expect(s.FILES.objects.size).toBe(1)
    await s.api('DELETE', `/subjects/${s.sid}/panels/${ds.panels[1].id}`)
    expect(s.FILES.objects.size).toBe(0)
  })

  it('deletes a result and a test for good, and the draws that leaves empty', async () => {
    await s.save('march.csv', CBC)
    const ds = await s.dataset()
    const [glucose, sodium] = ['Glucose', 'Sodium'].map((n) => ds.markers.find((m) => m.name === n)!)
    await s.api('PATCH', `/subjects/${s.sid}/results/${glucose.results[0].id}`, { notes: 'fasting' })
    expect((await s.api('DELETE', `/subjects/${s.sid}/results/${glucose.results[0].id}`)).status).toBe(200)
    expect(s.count('result_revisions')).toBe(0)
    expect((await s.api('DELETE', `/subjects/${s.sid}/markers/${sodium.id}`)).body).toMatchObject({ deleted: 1 })
    expect(s.count('lab_results') + s.count('lab_panels') + s.FILES.objects.size).toBe(0)
    expect((await s.dataset()).preferences.hidden_marker_ids).toEqual([sodium.id])
  })

  it('deletes a person and everything about them, and nothing about anyone else', async () => {
    await s.save('march.csv', CBC)
    await s.api('POST', `/subjects/${s.sid}/events`, { kind: 'medication', label: 'Example', start_date: '2025-01-01' })
    await s.api('POST', `/subjects/${s.sid}/views`, { name: 'Mine', path: '/history?m=x' })
    await s.upload('pending.csv', CBC)
    const other = (await s.api<{ id: string }>('POST', '/subjects', { display_name: 'Someone Else' })).body.id
    await s.api('POST', `/subjects/${other}/imports`, csv('theirs.csv', CBC)).then((r) => s.api('POST', `/subjects/${other}/imports/${(r.body as { id: string }).id}/commit`))

    expect((await s.api('DELETE', `/subjects/${s.sid}`)).status).toBe(400)
    expect((await s.api('DELETE', `/subjects/${s.sid}?confirm=sample%20person`)).status).toBe(200)
    for (const table of ['subjects', 'lab_panels', 'lab_results', 'files', 'import_batches', 'extraction_candidates', 'timeline_events', 'saved_views', 'preferences', 'panel_files']) {
      expect(s.DB.query(`SELECT * FROM ${table}`).every((row) => !JSON.stringify(row).includes(s.sid)), table).toBe(true)
    }
    expect([...s.FILES.objects.keys()].every((k) => k.startsWith(`${other}/`))).toBe(true)
    expect(s.FILES.objects.size).toBe(1)
    expect((await s.api<Dataset>('GET', `/subjects/${other}/dataset`)).body.panels).toHaveLength(1)
    expect((await s.api('GET', `/subjects/${s.sid}/dataset`)).status).toBe(404)
  })
})

describe('what a request may send', () => {
  it('turns a wrong type into a 400, never a saved value or a 500', async () => {
    const s = await setup()
    await s.save('march.csv', CBC)
    const ds = await s.dataset()
    const base = `/subjects/${s.sid}`
    const bad: [string, string, unknown][] = [
      ['PUT', `${base}/preferences`, { starred_marker_ids: 'mk_glucose' }],
      ['PUT', `${base}/preferences`, { starred_marker_ids: [1, 2] }],
      ['PATCH', `${base}/panels/${ds.panels[0].id}`, { tags: 'fasting' }],
      ['PATCH', `${base}/panels/${ds.panels[0].id}`, { draw_date: '2025-02-30' }],
      ['PATCH', `${base}/panels/${ds.panels[0].id}`, { draw_time: '25:99' }],
      ['PATCH', `${base}/results/${ds.markers[0].results[0].id}`, { marker_id: 'mk_does_not_exist' }],
      ['PATCH', `${base}/results/${ds.markers[0].results[0].id}`, { raw_value: 5 }],
      ['PUT', `${base}/targets/${ds.markers[0].id}`, { target_low: 'low' }],
      ['PUT', `${base}/targets/${ds.markers[0].id}`, { target_low: 9, target_high: 1 }],
      ['POST', `${base}/events`, { kind: 'medication', label: 'X', start_date: '2025-01-01', marker_ids: 'all' }],
      ['POST', `${base}/views`, { name: 'Elsewhere', path: '//example.com/x' }],
      ['POST', `${base}/views`, { name: 'Elsewhere', path: '/\\example.com/x' }],
      ['POST', `${base}/views`, { name: 'Elsewhere', path: 'https://example.com' }],
      ['POST', '/subjects', ['not', 'an', 'object']],
    ]
    for (const [method, path, body] of bad) expect((await s.api(method, path, body)).status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400)
    // Moving a result onto a test the draw already has is a conflict, not a crash.
    const [first, second] = ds.markers
    expect((await s.api('PATCH', `${base}/results/${first.results[0].id}`, { marker_id: second.id })).status).toBe(409)
    expect((await s.api('POST', `${base}/views`, { name: 'Glucose', path: '/history?m=glucose' })).status).toBe(201)
  })

  it('shows the list of people with access to the owner only', async () => {
    const s = await setup()
    await s.api('POST', '/instance/people', { email: 'Guest@Example.com' })
    expect((await s.api<{ people: { email: string }[] }>('GET', '/instance')).body.people.map((p) => p.email)).toEqual(['guest@example.com'])
  })
})

describe('rows stored under older rules', () => {
  it('are brought up to date a step at a time, and what was deleted is removed', async () => {
    const s = await setup()
    const now = '2026-01-01T00:00:00.000Z'
    s.DB.query("DELETE FROM app_state WHERE key = 'data'")
    forgetUpgrade()
    const sql = (text: string, ...args: (string | number | null)[]) => s.DB.query(text, ...args)
    sql('INSERT INTO lab_panels (id, subject_id, draw_date, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', 'pn_kept', s.sid, '2025-03-04', '[]', now, now)
    sql('INSERT INTO lab_panels (id, subject_id, draw_date, tags, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'pn_gone', s.sid, '2024-01-01', '[]', now, now, now)
    // Stored by the old parser: "600 - 1,500" as 1 to 600, so 900 was flagged high; and a flag the lab did report.
    const result = (id: string, panel: string, marker: string, value: string, ref: string | null, low: number | null, high: number | null, flag: string | null, source: string | null) =>
      sql(
        `INSERT INTO lab_results (id, panel_id, subject_id, marker_id, raw_value, comparator, value_numeric, reference_text, ref_low, ref_high, lab_flag, flag_source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '=', ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, panel, s.sid, marker, value, Number(value), ref, low, high, flag, source, now, now,
      )
    const [m1, m2, m3] = sql('SELECT id FROM lab_markers ORDER BY id LIMIT 3').map((m) => String(m.id))
    result('rs_wrong', 'pn_kept', m1, '900', '600 - 1,500 mg/dL', 1, 600, 'high', 'inferred')
    result('rs_reported', 'pn_kept', m2, '5', '3-10', 3, 10, 'critical', 'reported')
    result('rs_gone', 'pn_gone', m3, '1', null, null, null, null, null)
    sql("INSERT INTO result_revisions (id, result_id, action, before_json, changed_at) VALUES ('rv_1', 'rs_deleted_long_ago', 'delete', '{}', ?)", now)
    // An import saved before sources were linked: its file only shows on the draw once it is linked by date.
    for (const [file, batch, candidate, status, batchStatus] of [['fl_second', 'ib_done', 'cd_done', 'committed', 'committed'], ['fl_junk', 'ib_junk', 'cd_junk', 'discarded', 'discarded']]) {
      sql('INSERT INTO files (id, subject_id, r2_key, filename, created_at) VALUES (?, ?, ?, ?, ?)', file, s.sid, `${s.sid}/${file}/report.pdf`, 'report.pdf', now)
      await s.FILES.put(`${s.sid}/${file}/report.pdf`, 'bytes')
      sql('INSERT INTO import_batches (id, subject_id, status, created_at) VALUES (?, ?, ?, ?)', batch, s.sid, batchStatus, now)
      sql('INSERT INTO extraction_candidates (id, batch_id, subject_id, file_id, source_kind, status, document, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        candidate, batch, s.sid, file, 'pdf', status, JSON.stringify({ source_kind: 'pdf', document_warnings: [], panels: [{ draw_date: '2025-03-04', results: [{ raw_name: 'X', raw_value: '1' }] }] }), now, now)
    }
    sql("INSERT INTO lab_marker_aliases (id, marker_id, source_name, normalized_name, scope, created_at) VALUES ('al_old', ?, 'Example Count #', 'example count', ?, ?)", m1, s.sid, now)

    for (let i = 0; i < 40; i++) await upgradeData(s.env)

    expect(JSON.parse(String(sql("SELECT value FROM app_state WHERE key = 'data'")[0].value))).toEqual({ version: DATA_VERSION })
    expect(sql("SELECT ref_low, ref_high, lab_flag, flag_source FROM lab_results WHERE id = 'rs_wrong'")[0]).toEqual({ ref_low: 600, ref_high: 1500, lab_flag: null, flag_source: null })
    expect(sql("SELECT lab_flag, flag_source FROM lab_results WHERE id = 'rs_reported'")[0]).toEqual({ lab_flag: 'critical', flag_source: 'reported' })
    expect(sql('SELECT id FROM lab_panels').map((p) => p.id)).toEqual(['pn_kept'])
    expect(sql('SELECT id FROM lab_results ORDER BY id').map((r) => r.id)).toEqual(['rs_reported', 'rs_wrong'])
    expect(s.count('result_revisions')).toBe(0)
    expect(sql('SELECT panel_id, file_id FROM panel_files')).toEqual([{ panel_id: 'pn_kept', file_id: 'fl_second' }])
    expect(sql('SELECT id, document FROM extraction_candidates')).toEqual([{ id: 'cd_done', document: null }])
    expect(sql('SELECT id FROM import_batches').map((b) => b.id)).toEqual(['ib_done'])
    expect([...s.FILES.objects.keys()]).toEqual([`${s.sid}/fl_second/report.pdf`])
    expect(sql("SELECT normalized_name FROM lab_marker_aliases WHERE source_name = 'Example Count #' ORDER BY normalized_name").map((a) => a.normalized_name)).toEqual(['example count', 'example count absolute'])
  })
})

describe('built-in test names', () => {
  it('still match every name they had before 0009 renamed them, and no two tests answer to one name', async () => {
    forgetCatalog()
    const catalog = await loadCatalog(testDatabase())
    const index = markerIndex(catalog, new Map())
    // The names each test had before: the migration only renames a test whose name is still the one it lists.
    const sql = readFileSync(new URL('../migrations/0009_builtin_tests.sql', import.meta.url), 'utf8')
    const before = [...sql.matchAll(/WHERE id = '(mk_\w+)' AND (?:name|long_name) = '((?:[^']|'')+)'/g)].map((m) => [m[1], m[2].replace(/''/g, "'")])
    expect(before.length).toBeGreaterThan(40)
    for (const [id, name] of before) expect([name, index.lookup(name, null)?.id]).toEqual([name, id])

    const owner = new Map<string, string>()
    for (const marker of catalog.markers.values()) {
      for (const name of [marker.name, marker.long_name]) {
        if (!name) continue
        expect([name, index.lookup(name, null)?.id]).toEqual([name, marker.id])
        const key = normalizeAlias(name)
        expect([name, owner.get(key) ?? marker.id]).toEqual([name, marker.id])
        owner.set(key, marker.id)
      }
    }
    forgetCatalog()
  })
})
