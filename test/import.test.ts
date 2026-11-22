import { describe, expect, it } from 'vitest'
import type { ExtractedPanel, ExtractionDocument } from '../src/shared/types'
import { chunkPages, denseLength, mergePanels, splitText } from '../src/worker/chunking'
import { finishDocument, readPages } from '../src/worker/extraction'
import { isPlanRefusal, isTransient } from '../src/worker/lib'
import { annotateDocument, nearDuplicate, type SavedByDate } from '../src/worker/resolve'

const row = (raw_name: string, raw_value: string, marker_id?: string) => ({ raw_name, raw_value, ...(marker_id ? { marker_id } : {}) })

describe('model errors', () => {
  // The text Workers AI returns on the Workers Free plan for a model that needs Workers Paid.
  const refused = new Error('5035: Model @cf/example/model is not available on the Workers Free plan. Upgrade to access this model: https://dash.cloudflare.com/?to=/:account/workers/plans')

  it('does not retry a model the plan does not offer', () => {
    expect(isPlanRefusal(refused)).toBe(true)
    expect(isTransient(refused)).toBe(false)
  })

  it('still retries capacity, rate and upstream errors', () => {
    for (const message of ['3040: Capacity temporarily exceeded', '429 Too Many Requests', 'InferenceUpstreamError: 503', 'Network connection lost', 'The operation timed out']) {
      expect(isTransient(new Error(message))).toBe(true)
      expect(isPlanRefusal(new Error(message))).toBe(false)
    }
    expect(isTransient(new Error('Uploaded file is missing'))).toBe(false)
  })
})

describe('chunking', () => {
  it('packs whole pages under the budget', () => {
    const page = (n: number) => `Page ${n}\n` + 'x'.repeat(2_990)
    const chunks = chunkPages(Array.from({ length: 10 }, (_, i) => page(i + 1)), 9_000)
    expect(chunks.map((c) => c.pages)).toEqual([[1, 3], [4, 6], [7, 9], [10, 10]])
  })
  it('splits a long page at blank lines without losing lines', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => `Test ${i}\nNormal range: 1 - 10\n${i}.5`)
    const text = blocks.join('\n\n')
    const pieces = splitText(text, 200)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.every((p) => denseLength(p) <= 200)).toBe(true)
    // Each test's three lines stay in one piece.
    for (const b of blocks) expect(pieces.some((p) => p.includes(b))).toBe(true)
  })
  it('merges panels by date and drops rows repeated across chunks', () => {
    const merged = mergePanels([
      { draw_date: '2026-03-12', facility: 'Quest', results: [row('Glucose', '92'), row('LDL', '100')] },
      { draw_date: '2026-03-12', facility: null, results: [row('LDL', '100.0'), row('HDL', '55')] },
      { draw_date: '2026-03-12', accession_number: 'B2', results: [row('Ferritin', '40')] },
      { draw_date: '2026-03-12', accession_number: 'A1', results: [row('TSH', '1.2')] },
      { draw_date: null, results: [row('A1c', '5.4')] },
    ] as ExtractedPanel[])
    expect(merged.map((p) => [p.draw_date, p.results.map((r) => r.raw_name).join(',')])).toEqual([
      ['2026-03-12', 'Glucose,LDL,HDL,Ferritin'],
      ['2026-03-12', 'TSH'],
      [null, 'A1c'],
    ])
    expect(merged[0].facility).toBe('Quest')
  })
})

/** Fake model: reads "NAME DATE VALUE" lines from the last fenced block; replies are cut off past `cap` rows. */
function fakeEnv(cap: number) {
  let calls = 0
  const run = async (_model: string, input: { messages: { role: string; content: unknown }[] }) => {
    calls++
    const user = input.messages.find((m) => m.role === 'user')!.content as { type: string; text?: string }[]
    const text = user.find((p) => p.type === 'text')!.text!
    const blocks = [...text.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1])
    const body = blocks.at(-1) ?? ''
    if (body.includes('BROKEN')) return { choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }] }
    const rows = [...body.matchAll(/^(\S+) (\d{4}-\d{2}-\d{2}) ([\d.]+)$/gm)]
    if (rows.length > cap) return { choices: [{ message: { content: '{"panels":[{"results":[' + '{"raw_name":"X"},'.repeat(200) }, finish_reason: 'length' }] }
    const byDate = new Map<string, { raw_name: string; raw_value: string }[]>()
    for (const [, name, date, value] of rows) byDate.set(date, [...(byDate.get(date) ?? []), { raw_name: name, raw_value: value }])
    const panels = [...byDate].map(([date, results]) => ({ collected_at: date, results }))
    return { choices: [{ message: { content: JSON.stringify({ panels }) }, finish_reason: 'stop' }] }
  }
  return { env: { AI: { run } } as unknown as Env, calls: () => calls }
}

describe('reading long PDFs', () => {
  it('splits a chunk whose reply is cut off and merges every result back by date', async () => {
    const dates = ['2026-01-05', '2026-02-05', '2026-03-05']
    const pages = dates.map((date, p) =>
      Array.from({ length: 6 }, (_, b) => Array.from({ length: 10 }, (_, i) => `T${p}_${b}_${i} ${date} ${i}.5`).join('\n')).join('\n\n'),
    )
    const { env, calls } = fakeEnv(50)
    const read = await readPages(env, 'fake', 'history.pdf', pages)
    const doc = finishDocument('pdf', read.panels, read.warnings)
    expect(doc.panels.map((p) => [p.draw_date, p.results.length])).toEqual(dates.map((d) => [d, 60]))
    expect(doc.document_warnings).toEqual([])
    expect(calls()).toBeGreaterThan(1)
  })
  it('keeps the other chunks when one cannot be read', async () => {
    const filler = (tag: string) => Array.from({ length: 40 }, (_, i) => `${tag} filler line ${i} `.padEnd(70, '.')).join('\n')
    const pages = [`A 2026-01-05 1.5\n${filler('a')}`, `BROKEN\n${filler('b')}`, `C 2026-01-05 3.5\n${filler('c')}`]
    const read = await readPages(fakeEnv(50).env, 'fake', 'report.pdf', pages)
    const doc = finishDocument('pdf', read.panels, read.warnings)
    expect(doc.panels[0].results.map((r) => r.raw_name)).toEqual(['A', 'C'])
    expect(doc.document_warnings).toEqual(['Page 2 could not be read, so results there are missing. Check them against the report.'])
  })
})

/** Minimal D1 stand-in for annotateDocument's three queries. */
function fakeDb(saved: { panel_id: string; draw_date: string; marker_id: string; raw_value: string }[]) {
  const markers = ['glucose', 'ferritin', 'ldl'].map((slug) => ({ id: `mk_${slug}`, slug, name: slug, long_name: null, loinc_code: null, category: 'metabolic', status: 'active', merged_into_id: null }))
  const stmt = (sql: string) => {
    let args: unknown[] = []
    const s = {
      bind: (...a: unknown[]) => ((args = a), s),
      first: async () => null,
      all: async () => {
        if (sql.includes('FROM lab_markers')) return { results: markers }
        if (sql.includes('FROM lab_marker_aliases')) return { results: [] }
        const [, from, to] = args as string[]
        return { results: saved.filter((r) => r.draw_date >= from && r.draw_date <= to).map((r, i) => ({ id: `rs_${i}`, raw_units: null, ...r })) }
      },
    }
    return s
  }
  return { prepare: stmt, batch: (list: { all: () => Promise<unknown> }[]) => Promise.all(list.map((s) => s.all())) } as unknown as D1Database
}

describe('duplicate handling on review', () => {
  const saved = [
    { panel_id: 'pn_a', draw_date: '2026-03-12', marker_id: 'mk_glucose', raw_value: '92' },
    { panel_id: 'pn_a', draw_date: '2026-03-12', marker_id: 'mk_ferritin', raw_value: '38' },
    { panel_id: 'pn_b', draw_date: '2026-03-14', marker_id: 'mk_ldl', raw_value: '101' },
  ]
  const doc = (): ExtractionDocument => ({
    source_kind: 'pdf',
    document_warnings: [],
    panels: [{ draw_date: '2026-03-12', results: [row('Glucose', '92.0'), row('Ferritin', '40'), row('LDL', '100')] }],
  })

  it('leaves out saved values, keeps a differing saved value unless ticked, and rechecks after a date change', async () => {
    const db = fakeDb(saved)
    const first = await annotateDocument(db, 'demo', doc())
    expect(first.panels[0].results.map((r) => [r.raw_name, r.include, r.existing?.raw_value ?? null])).toEqual([
      ['Glucose', false, '92'],
      ['Ferritin', false, '38'],
      ['LDL', true, null],
    ])
    // Ticking the differing row sticks across saves.
    first.panels[0].results[1].include = true
    const again = await annotateDocument(db, 'demo', first)
    expect(again.panels[0].results[1].include).toBe(true)
    // Moving the draw lines LDL up with a different saved value: back to keeping the saved one.
    again.panels[0].draw_date = '2026-03-14'
    const moved = await annotateDocument(db, 'demo', again)
    expect(moved.panels[0].results.find((r) => r.raw_name === 'LDL')).toMatchObject({ include: false, existing: { raw_value: '101' } })
  })

  it('flags a saved draw a few days off with the same numbers', () => {
    const byDate: SavedByDate = new Map([
      ['2026-03-14', { panel_id: 'pn_b', values: new Map([['m1', '4.5'], ['m2', '120'], ['m3', 'Negative']]) }],
      ['2026-03-16', { panel_id: 'pn_c', values: new Map([['m1', '4.5'], ['m2', '120']]) }],
    ])
    const panel = (draw_date: string, values: [string, string][]): ExtractedPanel => ({ draw_date, results: values.map(([m, v]) => row(m, v, m)) })
    const same = [['m1', '4.5'], ['m2', '120.0'], ['m3', 'Negative']] as [string, string][]
    expect(nearDuplicate(panel('2026-03-12', same), byDate)).toEqual({ draw_date: '2026-03-14', panel_id: 'pn_b', matching: 2, compared: 2 })
    // Tests only one side has don't dilute the match (the saved draw may come from a smaller report).
    const more = [...same, ['m4', '7.7'], ['m5', '140'], ['m6', '3.1']] as [string, string][]
    expect(nearDuplicate(panel('2026-03-12', more), byDate)).toMatchObject({ draw_date: '2026-03-14', matching: 2, compared: 2 })
    // One matching number, text values, or a draw a week away are not enough.
    expect(nearDuplicate(panel('2026-03-12', [['m1', '4.5'], ['m2', '118']]), byDate)).toBeNull()
    expect(nearDuplicate(panel('2026-03-12', [['m3', 'Negative']]), byDate)).toBeNull()
    expect(nearDuplicate(panel('2026-03-07', same), byDate)).toBeNull()
    // Already saved on its own date: nothing to suggest.
    expect(nearDuplicate(panel('2026-03-16', same), byDate)).toBeNull()
  })
})
