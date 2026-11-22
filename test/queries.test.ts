// What the database is asked to do. D1 bills and limits by rows read, and a
// request waits on every round trip, so each thing the app does often is
// checked here: every statement it runs must reach its rows through an index,
// and a page load must be one round trip.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Dataset, ImportBatch } from '../src/shared/types'
import { forgetCatalog } from '../src/worker/catalog'
import worker from '../src/worker/index'
import { forgetUpgrade } from '../src/worker/upgrade'
import { testEnv } from './helpers'

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const t = testEnv()
let sid = ''

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const res = await worker.fetch(new Request(`http://localhost/api${path}`, init), t.env, ctx)
  if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

const upload = (name: string, text: string) => {
  const form = new FormData()
  form.append('files', new File([text], name, { type: 'text/csv' }))
  return api<ImportBatch>('POST', `/subjects/${sid}/imports`, form)
}

/** Tables small enough, or read rarely enough, that reading all of one is the right plan. */
const MAY_SCAN = new Set(['lab_markers', 'subjects', 'allowed_users', 'instance', 'app_state'])

/** Run something, then return every statement it ran that reads a table from end to end or sorts its rows. */
async function costly(work: () => Promise<unknown>): Promise<{ trips: number; problems: string[] }> {
  t.DB.log.length = 0
  t.DB.trips.count = 0
  await work()
  const problems: string[] = []
  for (const sql of new Set(t.DB.log)) {
    for (const line of t.DB.plan(sql)) {
      const scanned = line.match(/^SCAN (\w+)/)?.[1]
      // A scan is named by the table or by its alias in the statement.
      const table = scanned && (sql.match(new RegExp(`(\\w+)\\s+(?:AS\\s+)?${scanned}\\b`, 'i'))?.[1] ?? scanned)
      // An INSERT's plan lists a scan of each table that points at the new row. SQLite runs it only when a
      // foreign key is waiting on that row, which never happens here; the same scan under a DELETE is real.
      const foreignKeyOnInsert = /^\s*INSERT\b/i.test(sql) && scanned && !new RegExp(`\\b${scanned}\\b`).test(sql)
      const full = scanned && !line.includes('USING') && !foreignKeyOnInsert && !MAY_SCAN.has(scanned) && !MAY_SCAN.has(String(table))
      if (full || /TEMP B-TREE FOR ORDER BY/.test(line)) problems.push(`${line}  <=  ${sql.replace(/\s+/g, ' ').slice(0, 140)}`)
    }
  }
  return { trips: t.DB.trips.count, problems }
}

beforeAll(async () => {
  forgetCatalog()
  forgetUpgrade()
  sid = (await api<{ id: string }>('POST', '/subjects', { display_name: 'Sample Person' })).id
  // Sixty draws of thirty tests: a long history, so a plan that reads everything shows.
  const tests = Array.from({ length: 30 }, (_, i) => `Test ${String.fromCharCode(65 + (i % 26))}${i}`)
  const lines = ['Test,Value,Range,Date']
  for (let d = 0; d < 60; d++) {
    const date = new Date(Date.UTC(2020, 0, 1 + d * 30)).toISOString().slice(0, 10)
    for (const [i, name] of tests.entries()) lines.push(`${name},${(i + d) % 17},3-12,${date}`)
  }
  const batch = await upload('history.csv', lines.join('\n'))
  await api('POST', `/subjects/${sid}/imports/${batch.id}/commit`)
  // The data upgrade and the caches have settled before anything is measured.
  for (let i = 0; i < 8; i++) await api('GET', '/me')
  await api('GET', `/subjects/${sid}/dataset`)
})

describe('database work', () => {
  it('loads everything about a person in one round trip, through indexes, without sorting', async () => {
    let ds!: Dataset
    const cost = await costly(async () => void (ds = await api<Dataset>('GET', `/subjects/${sid}/dataset`)))
    expect(ds.panels).toHaveLength(60)
    expect(ds.markers.reduce((n, m) => n + m.results.length, 0)).toBe(1800)
    expect(ds.panels[0].draw_date > ds.panels[59].draw_date).toBe(true)
    expect(ds.markers[0].results[0].draw_date < ds.markers[0].results[59].draw_date).toBe(true)
    expect(cost.problems).toEqual([])
    expect(cost.trips).toBe(1)
  })

  it('reviews and saves an import without reading the whole history', async () => {
    let batch!: ImportBatch
    const reading = await costly(async () => void (batch = await upload('new.csv', 'Test,Value,Range,Date\nTest A0,5,3-12,2025-06-01\nSomething New,7,,2025-06-01\n')))
    expect(reading.problems).toEqual([])
    const path = `/subjects/${sid}/imports/${batch.id}`
    const polling = await costly(() => api('GET', `${path}?brief=1`))
    expect(polling).toEqual({ trips: 1, problems: [] })
    const full = await api<ImportBatch>('GET', path)
    const editing = await costly(() => api('PUT', `${path}/candidates/${full.candidates[0].id}`, { document: full.candidates[0].document }))
    expect(editing.problems).toEqual([])
    expect(editing.trips).toBeLessThanOrEqual(3)
    const saving = await costly(() => api('POST', `${path}/commit`))
    expect(saving.problems).toEqual([])
    expect((await costly(() => api('GET', `/subjects/${sid}/imports`))).problems).toEqual([])
  })

  it('edits and deletes through indexes', async () => {
    const ds = await api<Dataset>('GET', `/subjects/${sid}/dataset`)
    const marker = ds.markers.find((m) => m.name === 'Test B1')!
    const result = marker.results[0]
    const draw = ds.panels[5]
    const base = `/subjects/${sid}`
    for (const work of [
      () => api('PATCH', `${base}/results/${result.id}`, { raw_value: '4', notes: 'checked' }),
      () => api('DELETE', `${base}/results/${result.id}`),
      () => api('PATCH', `${base}/panels/${draw.id}`, { notes: 'fasting' }),
      () => api('DELETE', `${base}/panels/${draw.id}`),
      () => api('DELETE', `${base}/markers/${marker.id}`),
      () => api('GET', `${base}/files`),
      () => api('PUT', `${base}/preferences`, { starred_marker_ids: [ds.markers[0].id] }),
      () => api('PUT', `${base}/targets/${ds.markers[0].id}`, { target_high: 10 }),
      () => api('POST', `${base}/views`, { name: 'One', path: '/history?m=x' }),
      () => api('POST', `${base}/events`, { kind: 'medication', label: 'Example', start_date: '2024-01-01' }),
    ]) {
      expect((await costly(work)).problems).toEqual([])
    }
  })
})
