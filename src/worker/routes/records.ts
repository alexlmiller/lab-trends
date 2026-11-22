// One person's saved records: the dataset every chart reads, and the edits to
// draws, results, targets, events, views and preferences.
import { Hono } from 'hono'
import { isValidDate } from '../../shared/dates'
import { validatedPeriods } from '../../shared/events'
import { deriveResultFields } from '../../shared/semantics'
import type { Dataset, EventKind, EventPeriod, MarkerSeries, PersonalTarget, Result, TimelineEvent } from '../../shared/types'
import { loadCatalog } from '../catalog'
import { HttpError, jsonBody, newId, nowIso, number, parseJson, strings, text, type AppEnv } from '../lib'
import { eventOut, panelOut, RESULT_COLUMNS, RESULT_JSON, resultOut } from '../rows'
import { deleteFiles, deletePanels, unlinkedFileIds, unlinkedFiles } from '../storage'

export const records = new Hono<AppEnv>()

// ─── Dataset (everything the charts need) ───────────────────────────────

const PANEL_COLUMNS = 'id, draw_date, draw_time, facility, ordering_provider, accession_number, panel_name, notes, tags'
const EVENT_COLUMNS = 'id, kind, label, start_date, end_date, ongoing, additional_periods, period_note, notes, marker_ids, updated_at'

/**
 * Everything about one person in one round trip. Each query reads only that
 * person's rows through an index; the catalog comes from the isolate's copy.
 */
export async function loadDataset(db: D1Database, sid: string): Promise<Dataset> {
  const [subject, results, aliases, targets, panels, sources, events, prefs, views] = await db.batch([
    db.prepare('SELECT id, display_name FROM subjects WHERE id = ?').bind(sid),
    db
      .prepare(
        `SELECT ${RESULT_COLUMNS} FROM lab_panels p JOIN lab_results r ON r.panel_id = p.id
         WHERE p.subject_id = ? AND p.deleted_at IS NULL ORDER BY p.draw_date, p.draw_time, p.id`,
      )
      .bind(sid),
    db.prepare('SELECT marker_id, source_name FROM lab_marker_aliases WHERE scope = ?').bind(sid),
    db.prepare('SELECT id, marker_id, target_low, target_high, note FROM personal_targets WHERE subject_id = ?').bind(sid),
    db.prepare(`SELECT ${PANEL_COLUMNS} FROM lab_panels WHERE subject_id = ? AND deleted_at IS NULL ORDER BY draw_date DESC, draw_time DESC, id DESC`).bind(sid),
    db.prepare('SELECT pf.panel_id, f.id AS file_id, f.filename FROM files f JOIN panel_files pf ON pf.file_id = f.id WHERE f.subject_id = ?').bind(sid),
    db.prepare(`SELECT ${EVENT_COLUMNS} FROM timeline_events WHERE subject_id = ? ORDER BY start_date`).bind(sid),
    db.prepare('SELECT starred_marker_ids, hidden_marker_ids FROM preferences WHERE subject_id = ?').bind(sid),
    db.prepare('SELECT id, name, path, created_at FROM saved_views WHERE subject_id = ? ORDER BY created_at').bind(sid),
  ])
  if (!subject.results[0]) throw new HttpError(404, 'Person not found')

  const sourcesOf = new Map<string, { file_id: string; filename: string }[]>()
  for (const s of sources.results as { panel_id: string; file_id: string; filename: string }[]) {
    sourcesOf.set(s.panel_id, [...(sourcesOf.get(s.panel_id) ?? []), { file_id: s.file_id, filename: s.filename }])
  }
  const draws = (panels.results as Record<string, unknown>[]).map((p) => panelOut(p, sourcesOf.get(String(p.id))))
  const drawOf = new Map(draws.map((d) => [d.id, d]))
  // Results arrive in draw order; group them by test and count them by draw on the way.
  const byMarker = new Map<string, Result[]>()
  for (const row of results.results as Record<string, unknown>[]) {
    const draw = drawOf.get(String(row.panel_id))
    if (!draw) continue
    const r = resultOut(row, draw)
    const list = byMarker.get(r.marker_id)
    if (list) list.push(r)
    else byMarker.set(r.marker_id, [r])
    draw.result_count++
    if (r.lab_flag) draw.flagged_count++
  }
  const catalog = await loadCatalog(db, byMarker.keys())
  const ownAliases = new Map<string, string[]>()
  for (const a of aliases.results as { marker_id: string; source_name: string }[]) ownAliases.set(a.marker_id, [...(ownAliases.get(a.marker_id) ?? []), a.source_name])
  const targetOf = new Map<string, PersonalTarget>()
  for (const t of targets.results as Record<string, unknown>[]) {
    targetOf.set(String(t.marker_id), { id: String(t.id), marker_id: String(t.marker_id), target_low: t.target_low as number | null, target_high: t.target_high as number | null, note: (t.note as string) ?? null })
  }
  // A test is listed when the person has a result for it on a draw that still exists.
  const markers: MarkerSeries[] = []
  for (const [id, list] of byMarker) {
    const marker = catalog.markers.get(id)
    if (!marker) continue
    markers.push({ ...marker, aliases: [...new Set([...(catalog.aliases.get(id) ?? []), ...(ownAliases.get(id) ?? [])])], results: list, target: targetOf.get(id) ?? null })
  }
  const pref = prefs.results[0] as Record<string, unknown> | undefined
  return {
    subject: subject.results[0] as Dataset['subject'],
    markers,
    panels: draws,
    events: (events.results as Record<string, unknown>[]).map(eventOut),
    preferences: { starred_marker_ids: parseJson(pref?.starred_marker_ids, []), hidden_marker_ids: parseJson(pref?.hidden_marker_ids, []) },
    saved_views: views.results as Dataset['saved_views'],
  }
}

records.get('/subjects/:sid/dataset', async (c) => c.json(await loadDataset(c.env.DB, c.get('sid'))))

// ─── Draws ──────────────────────────────────────────────────────────────

records.patch('/subjects/:sid/panels/:pid', async (c) => {
  const sid = c.get('sid')
  const body = await jsonBody(c)
  const p = await c.env.DB.prepare(`SELECT ${PANEL_COLUMNS} FROM lab_panels WHERE id = ? AND subject_id = ? AND deleted_at IS NULL`).bind(c.req.param('pid'), sid).first<Record<string, string | null>>()
  if (!p) throw new HttpError(404, 'Draw not found')
  const date = text(body.draw_date, 'Date', 10) ?? p.draw_date
  if (!isValidDate(date)) throw new HttpError(400, 'Date must be a real date, written YYYY-MM-DD')
  const time = 'draw_time' in body ? text(body.draw_time, 'Time', 5) : p.draw_time
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Time must be written HH:MM')
  const tags = 'tags' in body && body.tags != null ? JSON.stringify([...new Set(strings(body.tags, 'Tags', 50).map((t) => t.trim().slice(0, 80)).filter(Boolean))]) : p.tags
  await c.env.DB.prepare('UPDATE lab_panels SET draw_date = ?, draw_time = ?, facility = ?, ordering_provider = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?')
    .bind(
      date,
      time,
      'facility' in body ? text(body.facility, 'Lab', 200) : p.facility,
      'ordering_provider' in body ? text(body.ordering_provider, 'Provider', 200) : p.ordering_provider,
      'notes' in body ? text(body.notes, 'Notes', 4_000) : p.notes,
      tags,
      nowIso(),
      p.id,
    )
    .run()
  return c.json({ ok: true })
})

/** Delete a draw for good: its results, the old copies of them, and any uploaded report only it was using. */
records.delete('/subjects/:sid/panels/:pid', async (c) => {
  const sid = c.get('sid')
  const pid = c.req.param('pid')
  if (!(await c.env.DB.prepare('SELECT 1 FROM lab_panels WHERE id = ? AND subject_id = ?').bind(pid, sid).first())) throw new HttpError(404, 'Draw not found')
  await deletePanels(c.env, sid, [pid])
  return c.json({ ok: true })
})

// ─── Results ────────────────────────────────────────────────────────────

records.patch('/subjects/:sid/results/:rid', async (c) => {
  const sid = c.get('sid')
  const db = c.env.DB
  const before = await db
    .prepare('SELECT id, panel_id, marker_id, raw_value, raw_units, reference_text, lab_flag, flag_source, notes FROM lab_results WHERE id = ? AND subject_id = ?')
    .bind(c.req.param('rid'), sid)
    .first<Record<string, string | null>>()
  if (!before) throw new HttpError(404, 'Result not found')
  const body = await jsonBody(c)
  const rawValue = text(body.raw_value, 'Value', 200) ?? String(before.raw_value)
  const reference = 'reference_text' in body ? text(body.reference_text, 'Reference range', 300) : before.reference_text
  const reportedFlag = 'lab_flag' in body ? text(body.lab_flag, 'Flag', 40) : before.flag_source === 'reported' ? before.lab_flag : null
  const d = deriveResultFields(rawValue, reference, reportedFlag)
  const markerId = text(body.marker_id, 'Test', 60) ?? String(before.marker_id)
  if (markerId !== before.marker_id) {
    // Moving a result to another test: the test must exist, and the draw must not already have a result for it.
    const [marker, clash] = await db.batch([
      db.prepare('SELECT 1 FROM lab_markers WHERE id = ?').bind(markerId),
      db.prepare('SELECT 1 FROM lab_results WHERE panel_id = ? AND marker_id = ?').bind(before.panel_id, markerId),
    ])
    if (!marker.results.length) throw new HttpError(400, 'That test does not exist')
    if (clash.results.length) throw new HttpError(409, 'This draw already has a result for that test')
  }
  const now = nowIso()
  const email = c.get('actor')
  await db.batch([
    // The old row is copied before it changes; the copy goes when the result is deleted.
    db.prepare(`INSERT INTO result_revisions (id, result_id, action, before_json, after_json, changed_at, changed_by) SELECT ?, id, 'update', ${RESULT_JSON}, ?, ?, ? FROM lab_results WHERE id = ?`)
      .bind(newId('rv'), JSON.stringify(body).slice(0, 4_000), now, email, before.id),
    db.prepare(
      `UPDATE lab_results SET marker_id = ?, raw_value = ?, comparator = ?, value_numeric = ?, value_text = ?, raw_units = ?, reference_text = ?, ref_low = ?, ref_high = ?,
         lab_flag = ?, flag_source = ?, notes = ?, corrected_at = ?, corrected_by = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      markerId, rawValue, d.comparator, d.value_numeric, d.value_text,
      'raw_units' in body ? text(body.raw_units, 'Units', 60) : before.raw_units,
      d.reference_text, d.ref_low, d.ref_high, d.lab_flag, d.flag_source,
      'notes' in body ? text(body.notes, 'Notes', 4_000) : before.notes,
      now, email, now, before.id,
    ),
  ])
  return c.json({ ok: true })
})

/** Delete a result for good, with every earlier version of it. */
records.delete('/subjects/:sid/results/:rid', async (c) => {
  const db = c.env.DB
  const rid = c.req.param('rid')
  const done = await db.batch([
    db.prepare('DELETE FROM result_revisions WHERE result_id IN (SELECT id FROM lab_results WHERE id = ? AND subject_id = ?)').bind(rid, c.get('sid')),
    db.prepare('DELETE FROM lab_results WHERE id = ? AND subject_id = ?').bind(rid, c.get('sid')),
  ])
  if (!done[1].meta.changes) throw new HttpError(404, 'Result not found')
  return c.json({ ok: true })
})

/**
 * Remove a test from one person's record for good: every result with its
 * earlier versions, their target, and any draw left empty. Optionally leave
 * the test out of future imports.
 */
records.delete('/subjects/:sid/markers/:mid', async (c) => {
  const sid = c.get('sid')
  const mid = c.req.param('mid')
  const db = c.env.DB
  const now = nowIso()
  // The person's results for this test, found through their draws: (draw, test) is the index results have.
  const theirs = 'marker_id = ?1 AND panel_id IN (SELECT id FROM lab_panels WHERE subject_id = ?2)'
  const statements = [
    db.prepare(`DELETE FROM result_revisions WHERE result_id IN (SELECT id FROM lab_results WHERE ${theirs})`).bind(mid, sid),
    db.prepare(`DELETE FROM lab_results WHERE ${theirs}`).bind(mid, sid),
    db.prepare('DELETE FROM personal_targets WHERE subject_id = ? AND marker_id = ?').bind(sid, mid),
  ]
  if (c.req.query('hide') !== '0') {
    const pref = await db.prepare('SELECT hidden_marker_ids FROM preferences WHERE subject_id = ?').bind(sid).first<{ hidden_marker_ids: string }>()
    const hidden = [...new Set([...parseJson<string[]>(pref?.hidden_marker_ids, []), mid])]
    statements.push(
      db
        .prepare(
          `INSERT INTO preferences (subject_id, hidden_marker_ids, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (subject_id) DO UPDATE SET hidden_marker_ids = excluded.hidden_marker_ids, updated_at = excluded.updated_at`,
        )
        .bind(sid, JSON.stringify(hidden), now),
    )
  }
  const done = await db.batch(statements)
  const empty = await db.prepare('SELECT p.id FROM lab_panels p WHERE p.subject_id = ? AND NOT EXISTS (SELECT 1 FROM lab_results r WHERE r.panel_id = p.id)').bind(sid).all<{ id: string }>()
  await deletePanels(c.env, sid, empty.results.map((p) => p.id))
  return c.json({ deleted: done[1].meta.changes })
})

// ─── Targets, events, views, preferences ────────────────────────────────

records.put('/subjects/:sid/targets/:mid', async (c) => {
  const sid = c.get('sid')
  const mid = c.req.param('mid')
  const body = await jsonBody(c)
  const low = number(body.target_low, 'At least')
  const high = number(body.target_high, 'At most')
  if (low == null && high == null) {
    await c.env.DB.prepare('DELETE FROM personal_targets WHERE subject_id = ? AND marker_id = ?').bind(sid, mid).run()
    return c.json({ ok: true, target: null })
  }
  if (low != null && high != null && low > high) throw new HttpError(400, '"At least" must not be above "At most"')
  if (!(await loadCatalog(c.env.DB, [mid])).markers.has(mid)) throw new HttpError(404, 'Test not found')
  const now = nowIso()
  const target = await c.env.DB.prepare(
    `INSERT INTO personal_targets (id, subject_id, marker_id, target_low, target_high, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (subject_id, marker_id) DO UPDATE SET target_low = excluded.target_low, target_high = excluded.target_high, note = excluded.note, updated_at = excluded.updated_at
     RETURNING id, marker_id, target_low, target_high, note`,
  )
    .bind(newId('tg'), sid, mid, low, high, text(body.note, 'Note', 500), now, now)
    .first()
  // The saved target comes back so the page can show it without fetching everything again.
  return c.json({ ok: true, target })
})

const EVENT_KINDS: EventKind[] = ['medication', 'procedure', 'illness', 'lifestyle', 'location', 'other']

function eventBody(body: Record<string, unknown>, existing?: TimelineEvent) {
  const label = text(body.label, 'Label', 200) ?? existing?.label
  if (!label) throw new HttpError(400, 'Label is required')
  let periods: EventPeriod[]
  try {
    const first = {
      start_date: body.start_date ?? existing?.start_date,
      end_date: body.end_date === undefined ? existing?.end_date : body.end_date,
      ongoing: body.ongoing ?? existing?.ongoing,
      note: body.note !== undefined ? body.note : existing?.periods[0]?.note,
    }
    periods = validatedPeriods(body.periods === undefined ? [first, ...(existing?.periods.slice(1) ?? [])] : body.periods)
  } catch (error) {
    throw new HttpError(400, (error as Error).message)
  }
  const kind = body.kind ?? existing?.kind
  return {
    kind: EVENT_KINDS.includes(kind as EventKind) ? (kind as EventKind) : 'other',
    label,
    start_date: periods[0].start_date,
    end_date: periods[0].end_date,
    ongoing: Number(periods[0].ongoing),
    additional: JSON.stringify(periods.slice(1)),
    period_note: periods[0].note ?? null,
    notes: 'notes' in body ? text(body.notes, 'Notes', 4_000) : (existing?.notes ?? null),
    marker_ids: JSON.stringify('marker_ids' in body && body.marker_ids != null ? strings(body.marker_ids, 'Tests', 500) : (existing?.marker_ids ?? [])),
  }
}

records.post('/subjects/:sid/events', async (c) => {
  const e = eventBody(await jsonBody(c))
  const id = newId('ev')
  const now = nowIso()
  const saved = await c.env.DB.prepare(
    `INSERT INTO timeline_events (id, subject_id, kind, label, start_date, end_date, ongoing, additional_periods, period_note, notes, marker_ids, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${EVENT_COLUMNS}`,
  )
    .bind(id, c.get('sid'), e.kind, e.label, e.start_date, e.end_date, e.ongoing, e.additional, e.period_note, e.notes, e.marker_ids, now, now, c.get('actor'))
    .first<Record<string, unknown>>()
  if (!saved) throw new Error('Event insert failed')
  return c.json({ id, event: eventOut(saved) }, 201)
})

records.patch('/subjects/:sid/events/:eid', async (c) => {
  const sid = c.get('sid')
  const eid = c.req.param('eid')
  const row = await c.env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM timeline_events WHERE id = ? AND subject_id = ?`).bind(eid, sid).first<Record<string, unknown>>()
  if (!row) throw new HttpError(404, 'Event not found')
  const patch = await jsonBody(c)
  if (patch.updated_at !== undefined && patch.updated_at !== row.updated_at) throw new HttpError(409, 'Event changed. Reload before saving.')
  const e = eventBody(patch, eventOut(row))
  const saved = await c.env.DB.prepare(
    `UPDATE timeline_events SET kind = ?, label = ?, start_date = ?, end_date = ?, ongoing = ?, additional_periods = ?, period_note = ?, notes = ?, marker_ids = ?, updated_at = ?
     WHERE id = ? AND subject_id = ? AND updated_at = ? RETURNING ${EVENT_COLUMNS}`,
  )
    .bind(e.kind, e.label, e.start_date, e.end_date, e.ongoing, e.additional, e.period_note, e.notes, e.marker_ids, nowIso(), eid, sid, row.updated_at)
    .first<Record<string, unknown>>()
  if (!saved) throw new HttpError(409, 'Event changed. Reload and try again.')
  return c.json({ ok: true, event: eventOut(saved) })
})

records.delete('/subjects/:sid/events/:eid', async (c) => {
  await c.env.DB.prepare('DELETE FROM timeline_events WHERE id = ? AND subject_id = ?').bind(c.req.param('eid'), c.get('sid')).run()
  return c.json({ ok: true })
})

records.post('/subjects/:sid/views', async (c) => {
  const body = await jsonBody(c)
  const name = text(body.name, 'Name', 100)
  const path = text(body.path, 'Path', 2_000)
  // A view is a page of this app: one leading slash, so the link can never point at another site.
  if (!name || !path || !/^\/(?![/\\])/.test(path) || /[\\\u0000-\u001f]/.test(path)) throw new HttpError(400, 'A view needs a name and a page of this app')
  const view = { id: newId('vw'), name, path, created_at: nowIso() }
  await c.env.DB.prepare('INSERT INTO saved_views (id, subject_id, name, path, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(view.id, c.get('sid'), name, path, view.created_at, c.get('actor'))
    .run()
  return c.json(view, 201)
})

records.delete('/subjects/:sid/views/:vid', async (c) => {
  await c.env.DB.prepare('DELETE FROM saved_views WHERE id = ? AND subject_id = ?').bind(c.req.param('vid'), c.get('sid')).run()
  return c.json({ ok: true })
})

records.put('/subjects/:sid/preferences', async (c) => {
  const body = await jsonBody(c)
  const value = (key: string, field: string) => (body[key] == null ? null : JSON.stringify([...new Set(strings(body[key], field, 2_000))]))
  await c.env.DB.prepare(
    `INSERT INTO preferences (subject_id, starred_marker_ids, hidden_marker_ids, updated_at) VALUES (?1, COALESCE(?2, '[]'), COALESCE(?3, '[]'), ?4)
     ON CONFLICT (subject_id) DO UPDATE SET starred_marker_ids = COALESCE(?2, preferences.starred_marker_ids),
       hidden_marker_ids = COALESCE(?3, preferences.hidden_marker_ids), updated_at = excluded.updated_at`,
  )
    .bind(c.get('sid'), value('starred_marker_ids', 'Watched tests'), value('hidden_marker_ids', 'Removed tests'), nowIso())
    .run()
  return c.json({ ok: true })
})

// ─── Stored files ───────────────────────────────────────────────────────

/** Uploads kept for this person that no draw shows: left by imports saved before every source was linked. */
records.get('/subjects/:sid/files', async (c) => c.json(await unlinkedFiles(c.env.DB, c.get('sid'))))

records.delete('/subjects/:sid/files/:fid', async (c) => {
  const fid = c.req.param('fid')
  if (!(await unlinkedFileIds(c.env.DB, c.get('sid'))).includes(fid)) throw new HttpError(409, 'A draw or an import still uses this file. Delete that first.')
  await deleteFiles(c.env, [fid])
  return c.json({ ok: true })
})
