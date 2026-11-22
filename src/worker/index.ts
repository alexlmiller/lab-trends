import { Hono } from 'hono'
import { validatedPeriods } from '../shared/events'
import { normalizeCategory } from '../shared/categories'
import { normalizeAlias, slugify } from '../shared/markers'
import { deriveResultFields } from '../shared/semantics'
import type { Dataset, EventKind, EventPeriod, ExtractionDocument, Marker, MarkerSeries, Panel, Result, TimelineEvent } from '../shared/types'
import { instanceState, isDemo, requireAccess, sameOriginWrites } from './auth'
import { commitBatch } from './commit'
import { extractTabular, extractWithModel, modelsFor, PROMPT_VERSION } from './extraction'
import { HttpError, isPlanRefusal, isTransient, logMessage, newId, nowIso, parseJson, PLAN_REFUSAL_MESSAGE, sha256Hex, sourceKindFor, type AppEnv } from './lib'
import { annotateDocument } from './resolve'
import { isMcpRequest, mcpFetch } from './mcp/server'

const app = new Hono<AppEnv>().basePath('/api')

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400)
  console.error('unhandled', logMessage(err))
  return c.json({ error: 'Internal error' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))
app.use('*', sameOriginWrites)
app.use('*', requireAccess)
app.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
})

// ─── Identity & subjects ────────────────────────────────────────────────

app.get('/me', async (c) => {
  const subjects = await c.env.DB.prepare('SELECT id, display_name, sex, birth_date FROM subjects ORDER BY created_at').all()
  return c.json({
    email: c.get('email'),
    owner: c.get('owner'),
    subjects: subjects.results,
    document_imports: Boolean(c.env.EXTRACTIONS),
    extraction_models: modelsFor(c.env),
    demo: isDemo(c.env),
  })
})

// ─── Who has access ─────────────────────────────────────────────────────

app.get('/instance', async (c) => {
  const state = await instanceState(c.env)
  return c.json({
    // No owner on record only in local development, where the signed-in address is the owner.
    owner_email: state.ownerSetting ?? state.row?.owner_email ?? c.get('email'),
    access: state.trusted ? { team_domain: state.trusted.team, source: state.configured ? 'settings' : 'first_sign_in' } : null,
    people: state.people,
  })
})

app.post('/instance/people', async (c) => {
  if (!c.get('owner')) throw new HttpError(403, 'Only the owner can change who has access')
  const body = await c.req.json<{ email?: string }>()
  const email = body.email?.trim().toLowerCase() ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter an email address')
  await c.env.DB.prepare('INSERT OR IGNORE INTO allowed_users (email, added_at, added_by) VALUES (?, ?, ?)').bind(email, nowIso(), c.get('actor')).run()
  return c.json({ ok: true }, 201)
})

app.delete('/instance/people/:email', async (c) => {
  if (!c.get('owner')) throw new HttpError(403, 'Only the owner can change who has access')
  await c.env.DB.prepare('DELETE FROM allowed_users WHERE email = ?').bind(c.req.param('email').toLowerCase()).run()
  return c.json({ ok: true })
})

app.post('/subjects', async (c) => {
  const body = await c.req.json<{ display_name?: string; sex?: string; birth_date?: string }>()
  const name = body.display_name?.trim()
  if (!name) throw new HttpError(400, 'Name is required')
  const id = newId('sb')
  const now = nowIso()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO subjects (id, display_name, sex, birth_date, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, body.sex ?? null, body.birth_date ?? null, now),
    c.env.DB.prepare("INSERT INTO preferences (subject_id, starred_marker_ids, section_order, updated_at) VALUES (?, '[]', '[]', ?)").bind(id, now),
  ])
  return c.json({ id, display_name: name, sex: body.sex ?? null, birth_date: body.birth_date ?? null }, 201)
})

app.patch('/subjects/:sid', async (c) => {
  const sid = await subjectId(c)
  const body = await c.req.json<{ display_name?: string; sex?: string | null; birth_date?: string | null }>()
  await c.env.DB.prepare('UPDATE subjects SET display_name = COALESCE(?, display_name), sex = ?, birth_date = ? WHERE id = ?')
    .bind(body.display_name?.trim() || null, body.sex ?? null, body.birth_date ?? null, sid)
    .run()
  return c.json({ ok: true })
})

// ─── Dataset (everything the charts need) ───────────────────────────────

app.get('/subjects/:sid/dataset', async (c) => {
  const sid = await subjectId(c)
  const db = c.env.DB
  const [subject, markers, results, aliases, targets, panels, events, prefs, views] = await db.batch([
    db.prepare('SELECT id, display_name, sex, birth_date FROM subjects WHERE id = ?').bind(sid),
    db.prepare('SELECT DISTINCT m.* FROM lab_markers m JOIN lab_results r ON r.marker_id = m.id WHERE r.subject_id = ?').bind(sid),
    db.prepare(
      `SELECT r.*, p.draw_date, p.draw_time, p.facility, p.tags AS panel_tags FROM lab_results r
       JOIN lab_panels p ON p.id = r.panel_id WHERE r.subject_id = ? AND p.deleted_at IS NULL ORDER BY p.draw_date, p.draw_time, p.id`,
    ).bind(sid),
    db.prepare(
      `SELECT a.marker_id, a.source_name FROM lab_marker_aliases a WHERE a.scope IN ('global', ?)
       AND a.marker_id IN (SELECT DISTINCT marker_id FROM lab_results WHERE subject_id = ?)`,
    ).bind(sid, sid),
    db.prepare('SELECT * FROM personal_targets WHERE subject_id = ?').bind(sid),
    db.prepare(
      `SELECT p.*, f.filename AS source_filename,
         (SELECT COUNT(*) FROM lab_results r WHERE r.panel_id = p.id) AS result_count,
         (SELECT COUNT(*) FROM lab_results r WHERE r.panel_id = p.id AND r.lab_flag IS NOT NULL) AS flagged_count
       FROM lab_panels p LEFT JOIN files f ON f.id = p.source_file_id
       WHERE p.subject_id = ? AND p.deleted_at IS NULL ORDER BY p.draw_date DESC, p.draw_time DESC, p.id DESC`,
    ).bind(sid),
    db.prepare('SELECT * FROM timeline_events WHERE subject_id = ? ORDER BY start_date').bind(sid),
    db.prepare('SELECT * FROM preferences WHERE subject_id = ?').bind(sid),
    db.prepare('SELECT id, name, path, created_at FROM saved_views WHERE subject_id = ? ORDER BY created_at').bind(sid),
  ])
  const aliasMap = new Map<string, string[]>()
  for (const a of aliases.results as { marker_id: string; source_name: string }[]) {
    const list = aliasMap.get(a.marker_id) ?? []
    list.push(a.source_name)
    aliasMap.set(a.marker_id, list)
  }
  const byMarker = new Map<string, Result[]>()
  for (const r of results.results as Record<string, unknown>[]) {
    const list = byMarker.get(String(r.marker_id)) ?? []
    list.push(resultOut(r))
    byMarker.set(String(r.marker_id), list)
  }
  const targetMap = new Map((targets.results as Record<string, unknown>[]).map((t) => [String(t.marker_id), t]))
  const series: MarkerSeries[] = (markers.results as Record<string, unknown>[]).map((m) => {
    const t = targetMap.get(String(m.id))
    return {
      ...markerOut(m),
      aliases: [...new Set(aliasMap.get(String(m.id)) ?? [])],
      results: byMarker.get(String(m.id)) ?? [],
      target: t ? { id: String(t.id), marker_id: String(t.marker_id), target_low: num(t.target_low), target_high: num(t.target_high), note: (t.note as string) ?? null } : null,
    }
  })
  const pref = prefs.results[0] as Record<string, unknown> | undefined
  const dataset: Dataset = {
    subject: subject.results[0] as Dataset['subject'],
    markers: series,
    panels: (panels.results as Record<string, unknown>[]).map(panelOut),
    events: (events.results as Record<string, unknown>[]).map(eventOut),
    preferences: {
      starred_marker_ids: parseJson(pref?.starred_marker_ids, []),
      section_order: parseJson(pref?.section_order, []),
      hidden_marker_ids: parseJson(pref?.hidden_marker_ids, []),
    },
    saved_views: views.results as Dataset['saved_views'],
  }
  if (!dataset.subject) throw new HttpError(404, 'Person not found')
  return c.json(dataset)
})

// ─── Markers (catalog) ──────────────────────────────────────────────────

app.get('/markers', async (c) => {
  const [markers, aliases] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM lab_markers WHERE status = 'active' ORDER BY category, name"),
    c.env.DB.prepare("SELECT marker_id, source_name FROM lab_marker_aliases WHERE scope = 'global'"),
  ])
  const aliasMap = new Map<string, string[]>()
  for (const a of aliases.results as { marker_id: string; source_name: string }[]) aliasMap.set(a.marker_id, [...(aliasMap.get(a.marker_id) ?? []), a.source_name])
  return c.json((markers.results as Record<string, unknown>[]).map((m) => ({ ...markerOut(m), aliases: aliasMap.get(String(m.id)) ?? [] })))
})

app.post('/markers', async (c) => {
  const body = await c.req.json<{ name?: string; category?: string; default_units?: string | null; long_name?: string | null }>()
  const name = body.name?.trim()
  if (!name) throw new HttpError(400, 'Name is required')
  const marker = await createMarker(c.env.DB, { name, category: normalizeCategory(body.category), default_units: body.default_units ?? null, long_name: body.long_name ?? null })
  return c.json(marker, 201)
})

app.patch('/markers/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<Partial<Marker>>()
  const existing = await c.env.DB.prepare('SELECT * FROM lab_markers WHERE id = ?').bind(id).first()
  if (!existing) throw new HttpError(404, 'Marker not found')
  await c.env.DB.prepare(
    `UPDATE lab_markers SET name = ?, long_name = ?, category = ?, default_units = ?, description = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.name?.trim() || existing.name,
      body.long_name !== undefined ? body.long_name || null : existing.long_name,
      body.category ? normalizeCategory(body.category) : existing.category,
      body.default_units !== undefined ? body.default_units || null : existing.default_units,
      body.description !== undefined ? body.description || null : existing.description,
      nowIso(),
      id,
    )
    .run()
  return c.json(markerOut((await c.env.DB.prepare('SELECT * FROM lab_markers WHERE id = ?').bind(id).first())!))
})

/** Merge `id` into `into_id`: results and aliases move; conflicts on the same draw are reported, not dropped. */
app.post('/markers/:id/merge', async (c) => {
  const id = c.req.param('id')
  const { into_id } = await c.req.json<{ into_id: string }>()
  if (!into_id || into_id === id) throw new HttpError(400, 'Choose a different marker to merge into')
  const db = c.env.DB
  const [from, into] = await db.batch([db.prepare('SELECT * FROM lab_markers WHERE id = ?').bind(id), db.prepare('SELECT * FROM lab_markers WHERE id = ?').bind(into_id)])
  const fromMarker = from.results[0] as Record<string, unknown> | undefined
  if (!fromMarker || !into.results[0]) throw new HttpError(404, 'Marker not found')
  const conflicts = await db
    .prepare('SELECT a.id FROM lab_results a JOIN lab_results b ON a.panel_id = b.panel_id WHERE a.marker_id = ? AND b.marker_id = ?')
    .bind(id, into_id)
    .all<{ id: string }>()
  if (conflicts.results.length) {
    throw new HttpError(409, `${conflicts.results.length} draw(s) have both markers. Delete or correct those results first.`)
  }
  const now = nowIso()
  const moved = await db.batch([
    db.prepare('UPDATE lab_results SET marker_id = ?, updated_at = ? WHERE marker_id = ?').bind(into_id, now, id),
    db.prepare('UPDATE OR IGNORE lab_marker_aliases SET marker_id = ? WHERE marker_id = ?').bind(into_id, id),
    db.prepare('INSERT OR IGNORE INTO lab_marker_aliases (id, marker_id, source_name, normalized_name, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('al'), into_id, String(fromMarker.name), normalizeAlias(String(fromMarker.name)), 'global', now),
    db.prepare('UPDATE personal_targets SET marker_id = ? WHERE marker_id = ? AND subject_id NOT IN (SELECT subject_id FROM personal_targets WHERE marker_id = ?)').bind(into_id, id, into_id),
    db.prepare("UPDATE lab_markers SET status = 'merged', merged_into_id = ?, updated_at = ? WHERE id = ?").bind(into_id, now, id),
  ])
  return c.json({ moved_results: moved[0].meta.changes })
})

// ─── Panels & results ───────────────────────────────────────────────────

app.get('/subjects/:sid/panels/:pid', async (c) => {
  const sid = await subjectId(c)
  const db = c.env.DB
  const panel = await db
    .prepare(
      `SELECT p.*, f.filename AS source_filename,
         (SELECT COUNT(*) FROM lab_results r WHERE r.panel_id = p.id) AS result_count,
         (SELECT COUNT(*) FROM lab_results r WHERE r.panel_id = p.id AND r.lab_flag IS NOT NULL) AS flagged_count
       FROM lab_panels p LEFT JOIN files f ON f.id = p.source_file_id WHERE p.id = ? AND p.subject_id = ? AND p.deleted_at IS NULL`,
    )
    .bind(c.req.param('pid'), sid)
    .first()
  if (!panel) throw new HttpError(404, 'Draw not found')
  const rows = await db
    .prepare(
      `SELECT r.*, p.draw_date, p.draw_time, p.facility, p.tags AS panel_tags, m.name AS marker_name, m.category AS marker_category,
         (SELECT json_object('id', r2.id, 'raw_value', r2.raw_value, 'value_numeric', r2.value_numeric, 'raw_units', r2.raw_units, 'draw_date', p2.draw_date, 'lab_flag', r2.lab_flag)
            FROM lab_results r2 JOIN lab_panels p2 ON p2.id = r2.panel_id
            WHERE r2.subject_id = r.subject_id AND r2.marker_id = r.marker_id AND p2.deleted_at IS NULL AND p2.draw_date < p.draw_date
            ORDER BY p2.draw_date DESC LIMIT 1) AS previous_json
       FROM lab_results r JOIN lab_panels p ON p.id = r.panel_id JOIN lab_markers m ON m.id = r.marker_id
       WHERE r.panel_id = ? ORDER BY m.category, m.name`,
    )
    .bind(c.req.param('pid'))
    .all<Record<string, unknown>>()
  return c.json({
    ...panelOut(panel),
    results: rows.results.map((r) => ({
      ...resultOut(r),
      marker_name: r.marker_name,
      marker_category: r.marker_category,
      previous: parseJson(r.previous_json, null),
    })),
  })
})

app.patch('/subjects/:sid/panels/:pid', async (c) => {
  const sid = await subjectId(c)
  const body = await c.req.json<{ draw_date?: string; draw_time?: string | null; facility?: string | null; ordering_provider?: string | null; notes?: string | null; tags?: string[] }>()
  if (body.draw_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.draw_date)) throw new HttpError(400, 'Date must be YYYY-MM-DD')
  const p = await c.env.DB.prepare('SELECT * FROM lab_panels WHERE id = ? AND subject_id = ?').bind(c.req.param('pid'), sid).first()
  if (!p) throw new HttpError(404, 'Draw not found')
  await c.env.DB.prepare('UPDATE lab_panels SET draw_date = ?, draw_time = ?, facility = ?, ordering_provider = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?')
    .bind(
      body.draw_date ?? p.draw_date,
      body.draw_time !== undefined ? body.draw_time : p.draw_time,
      body.facility !== undefined ? body.facility || null : p.facility,
      body.ordering_provider !== undefined ? body.ordering_provider || null : p.ordering_provider,
      body.notes !== undefined ? body.notes || null : p.notes,
      body.tags ? JSON.stringify([...new Set(body.tags.map((t) => t.trim()).filter(Boolean))]) : p.tags,
      nowIso(),
      p.id,
    )
    .run()
  return c.json({ ok: true })
})

app.delete('/subjects/:sid/panels/:pid', async (c) => {
  const sid = await subjectId(c)
  const res = await c.env.DB.prepare('UPDATE lab_panels SET deleted_at = ?, updated_at = ? WHERE id = ? AND subject_id = ? AND deleted_at IS NULL')
    .bind(nowIso(), nowIso(), c.req.param('pid'), sid)
    .run()
  if (!res.meta.changes) throw new HttpError(404, 'Draw not found')
  return c.json({ ok: true })
})

app.patch('/subjects/:sid/results/:rid', async (c) => {
  const sid = await subjectId(c)
  const db = c.env.DB
  const before = await db.prepare('SELECT * FROM lab_results WHERE id = ? AND subject_id = ?').bind(c.req.param('rid'), sid).first<Record<string, unknown>>()
  if (!before) throw new HttpError(404, 'Result not found')
  const body = await c.req.json<{ raw_value?: string; raw_units?: string | null; reference_text?: string | null; lab_flag?: string | null; notes?: string | null; marker_id?: string }>()
  const rawValue = (body.raw_value ?? String(before.raw_value)).trim()
  if (!rawValue) throw new HttpError(400, 'Value is required')
  const reference = body.reference_text !== undefined ? body.reference_text : (before.reference_text as string | null)
  const reportedFlag = body.lab_flag !== undefined ? body.lab_flag : before.flag_source === 'reported' ? (before.lab_flag as string | null) : null
  const d = deriveResultFields(rawValue, reference, reportedFlag)
  const markerId = body.marker_id ?? String(before.marker_id)
  const now = nowIso()
  const email = c.get('actor')
  await db.batch([
    db.prepare(
      `UPDATE lab_results SET marker_id = ?, raw_value = ?, comparator = ?, value_numeric = ?, value_text = ?, raw_units = ?, reference_text = ?, ref_low = ?, ref_high = ?,
         lab_flag = ?, flag_source = ?, notes = ?, corrected_at = ?, corrected_by = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      markerId, rawValue, d.comparator, d.value_numeric, d.value_text,
      body.raw_units !== undefined ? body.raw_units || null : before.raw_units,
      d.reference_text, d.ref_low, d.ref_high, d.lab_flag, d.flag_source,
      body.notes !== undefined ? body.notes || null : before.notes,
      now, email, now, before.id,
    ),
    db.prepare('INSERT INTO result_revisions (id, result_id, action, before_json, after_json, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('rv'), before.id, 'update', JSON.stringify(before), JSON.stringify(body), now, email),
  ])
  return c.json({ ok: true })
})

app.delete('/subjects/:sid/results/:rid', async (c) => {
  const sid = await subjectId(c)
  const db = c.env.DB
  const before = await db.prepare('SELECT * FROM lab_results WHERE id = ? AND subject_id = ?').bind(c.req.param('rid'), sid).first()
  if (!before) throw new HttpError(404, 'Result not found')
  await db.batch([
    db.prepare('INSERT INTO result_revisions (id, result_id, action, before_json, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('rv'), before.id, 'delete', JSON.stringify(before), nowIso(), c.get('actor')),
    db.prepare('DELETE FROM lab_results WHERE id = ?').bind(before.id),
  ])
  return c.json({ ok: true })
})

// ─── Targets, events, views, preferences ────────────────────────────────

app.put('/subjects/:sid/targets/:mid', async (c) => {
  const sid = await subjectId(c)
  const body = await c.req.json<{ target_low?: number | null; target_high?: number | null; note?: string | null }>()
  const low = body.target_low ?? null
  const high = body.target_high ?? null
  if (low == null && high == null) {
    await c.env.DB.prepare('DELETE FROM personal_targets WHERE subject_id = ? AND marker_id = ?').bind(sid, c.req.param('mid')).run()
    return c.json({ ok: true })
  }
  const now = nowIso()
  await c.env.DB.prepare(
    `INSERT INTO personal_targets (id, subject_id, marker_id, target_low, target_high, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (subject_id, marker_id) DO UPDATE SET target_low = excluded.target_low, target_high = excluded.target_high, note = excluded.note, updated_at = excluded.updated_at`,
  )
    .bind(newId('tg'), sid, c.req.param('mid'), low, high, body.note ?? null, now, now)
    .run()
  return c.json({ ok: true })
})

const EVENT_KINDS: EventKind[] = ['medication', 'procedure', 'illness', 'lifestyle', 'location', 'other']

function eventBody(body: Partial<TimelineEvent>, existing?: TimelineEvent) {
  const label = body.label?.trim()
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
  return {
    kind: EVENT_KINDS.includes(body.kind as EventKind) ? body.kind! : 'other',
    label,
    start_date: periods[0].start_date,
    end_date: periods[0].end_date,
    ongoing: Number(periods[0].ongoing),
    additional: JSON.stringify(periods.slice(1)),
    period_note: periods[0].note ?? null,
    notes: body.notes?.trim() || null,
    marker_ids: JSON.stringify(body.marker_ids ?? []),
  }
}

app.post('/subjects/:sid/events', async (c) => {
  const sid = await subjectId(c)
  const e = eventBody(await c.req.json())
  const id = newId('ev')
  const now = nowIso()
  const saved = await c.env.DB.prepare(
    'INSERT INTO timeline_events (id, subject_id, kind, label, start_date, end_date, ongoing, additional_periods, period_note, notes, marker_ids, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(id, sid, e.kind, e.label, e.start_date, e.end_date, e.ongoing, e.additional, e.period_note, e.notes, e.marker_ids, now, now, c.get('actor'))
    .first()
  if (!saved) throw new Error('Event insert failed')
  return c.json({ id, event: eventOut(saved) }, 201)
})

app.patch('/subjects/:sid/events/:eid', async (c) => {
  const sid = await subjectId(c)
  const eid = c.req.param('eid')
  const row = await c.env.DB.prepare('SELECT * FROM timeline_events WHERE id = ? AND subject_id = ?').bind(eid, sid).first()
  if (!row) throw new HttpError(404, 'Event not found')
  const existing = eventOut(row)
  const patch = await c.req.json<Partial<TimelineEvent>>()
  if (patch.updated_at !== undefined && patch.updated_at !== row.updated_at) throw new HttpError(409, 'Event changed. Reload before saving.')
  const e = eventBody({ ...existing, ...patch, periods: patch.periods }, existing)
  const saved = await c.env.DB.prepare(
    'UPDATE timeline_events SET kind = ?, label = ?, start_date = ?, end_date = ?, ongoing = ?, additional_periods = ?, period_note = ?, notes = ?, marker_ids = ?, updated_at = ? WHERE id = ? AND subject_id = ? AND updated_at = ? RETURNING *',
  )
    .bind(e.kind, e.label, e.start_date, e.end_date, e.ongoing, e.additional, e.period_note, e.notes, e.marker_ids, nowIso(), eid, sid, row.updated_at)
    .first()
  if (!saved) throw new HttpError(409, 'Event changed. Reload and try again.')
  return c.json({ ok: true, event: eventOut(saved) })
})

app.delete('/subjects/:sid/events/:eid', async (c) => {
  const sid = await subjectId(c)
  await c.env.DB.prepare('DELETE FROM timeline_events WHERE id = ? AND subject_id = ?').bind(c.req.param('eid'), sid).run()
  return c.json({ ok: true })
})

app.post('/subjects/:sid/views', async (c) => {
  const sid = await subjectId(c)
  const body = await c.req.json<{ name?: string; path?: string }>()
  if (!body.name?.trim() || !body.path?.startsWith('/')) throw new HttpError(400, 'Name and path are required')
  const id = newId('vw')
  await c.env.DB.prepare('INSERT INTO saved_views (id, subject_id, name, path, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, sid, body.name.trim(), body.path, nowIso(), c.get('actor'))
    .run()
  return c.json({ id }, 201)
})

app.delete('/subjects/:sid/views/:vid', async (c) => {
  const sid = await subjectId(c)
  await c.env.DB.prepare('DELETE FROM saved_views WHERE id = ? AND subject_id = ?').bind(c.req.param('vid'), sid).run()
  return c.json({ ok: true })
})

app.put('/subjects/:sid/preferences', async (c) => {
  const sid = await subjectId(c)
  const body = await c.req.json<{ starred_marker_ids?: string[]; section_order?: string[]; hidden_marker_ids?: string[] }>()
  const value = (k: keyof typeof body) => body[k] == null ? null : JSON.stringify(body[k])
  await c.env.DB.prepare(
    `INSERT INTO preferences (subject_id, starred_marker_ids, section_order, hidden_marker_ids, updated_at)
     VALUES (?1, COALESCE(?2, '[]'), COALESCE(?3, '[]'), COALESCE(?4, '[]'), ?5)
     ON CONFLICT (subject_id) DO UPDATE SET starred_marker_ids = COALESCE(?2, preferences.starred_marker_ids),
       section_order = COALESCE(?3, preferences.section_order), hidden_marker_ids = COALESCE(?4, preferences.hidden_marker_ids),
       updated_at = excluded.updated_at`,
  )
    .bind(sid, value('starred_marker_ids'), value('section_order'), value('hidden_marker_ids'), nowIso())
    .run()
  return c.json({ ok: true })
})

/**
 * Remove a marker from one person's record: every result (each kept as a
 * revision row), their target, and any draw left empty. Optionally leave the
 * marker out of future imports.
 */
app.delete('/subjects/:sid/markers/:mid', async (c) => {
  const sid = await subjectId(c)
  const mid = c.req.param('mid')
  const hide = c.req.query('hide') !== '0'
  const db = c.env.DB
  const rows = (await db.prepare('SELECT * FROM lab_results WHERE subject_id = ? AND marker_id = ?').bind(sid, mid).all<Record<string, unknown>>()).results
  const now = nowIso()
  const email = c.get('actor')
  const statements: D1PreparedStatement[] = rows.map((r) =>
    db
      .prepare('INSERT INTO result_revisions (id, result_id, action, before_json, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('rv'), r.id, 'delete_marker', JSON.stringify(r), now, email),
  )
  statements.push(
    db.prepare('DELETE FROM lab_results WHERE subject_id = ? AND marker_id = ?').bind(sid, mid),
    db.prepare('DELETE FROM personal_targets WHERE subject_id = ? AND marker_id = ?').bind(sid, mid),
    db
      .prepare('UPDATE lab_panels SET deleted_at = ?, updated_at = ? WHERE subject_id = ? AND deleted_at IS NULL AND id NOT IN (SELECT DISTINCT panel_id FROM lab_results)')
      .bind(now, now, sid),
  )
  if (hide) {
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
  await db.batch(statements)
  return c.json({ deleted: rows.length })
})

// ─── Imports ────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 20 * 1024 * 1024

app.post('/subjects/:sid/imports', async (c) => {
  const sid = await subjectId(c)
  const form = await c.req.formData()
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string')
  if (!files.length) throw new HttpError(400, 'Choose at least one file')
  const uploads = files.map(file => {
    const kind = sourceKindFor(file.name, file.type)
    if (!kind) throw new HttpError(400, `${file.name}: unsupported file type. Use PDF, an image, CSV or XLSX.`)
    if (file.size > MAX_FILE_BYTES) throw new HttpError(400, `${file.name} is larger than 20 MB`)
    if ((kind === 'pdf' || kind === 'image') && !c.env.EXTRACTIONS) {
      throw new HttpError(422, 'This deployment has no extraction queue, so it imports CSV and XLSX only.')
    }
    return { file, kind }
  })
  const db = c.env.DB
  const batchId = newId('ib')
  const now = nowIso()
  const email = c.get('actor')
  await db.prepare("INSERT INTO import_batches (id, subject_id, status, created_at, created_by) VALUES (?, ?, 'open', ?, ?)").bind(batchId, sid, now, email).run()
  for (const { file, kind } of uploads) {
    const bytes = await file.arrayBuffer()
    const sha = await sha256Hex(bytes)
    const fileId = newId('fl')
    const key = `${sid}/${fileId}/${file.name.replace(/[^\w.\- ]+/g, '_')}`
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type || 'application/octet-stream' } })
    const prior = await db.prepare('SELECT created_at FROM files WHERE subject_id = ? AND sha256 = ? ORDER BY created_at LIMIT 1').bind(sid, sha).first<{ created_at: string }>()
    const candidateId = newId('cd')
    await db.batch([
      db.prepare('INSERT INTO files (id, subject_id, r2_key, filename, mime_type, byte_size, sha256, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(fileId, sid, key, file.name, file.type || null, file.size, sha, now, email),
      db.prepare(
        "INSERT INTO extraction_candidates (id, batch_id, subject_id, file_id, source_kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
      ).bind(candidateId, batchId, sid, fileId, kind, now, now),
    ])
    if (kind === 'csv' || kind === 'xlsx') {
      try {
        const out = extractTabular(bytes, kind, file.name)
        if (prior) out.document.document_warnings.unshift(`This file was already uploaded on ${prior.created_at.slice(0, 10)}.`)
        await saveExtraction(c.env, candidateId, sid, out.document, null, 'local')
      } catch (err) {
        await failCandidate(db, candidateId, err)
      }
    } else {
      if (prior) {
        await db.prepare('UPDATE extraction_candidates SET error = ? WHERE id = ?').bind(`duplicate:${prior.created_at.slice(0, 10)}`, candidateId).run()
      }
      await c.env.EXTRACTIONS.send({ candidateId })
    }
  }
  return c.json(await loadBatch(db, sid, batchId, false), 201)
})

app.post('/subjects/:sid/imports/manual', async (c) => {
  const sid = await subjectId(c)
  const db = c.env.DB
  const batchId = newId('ib')
  const candidateId = newId('cd')
  const now = nowIso()
  const doc: ExtractionDocument = { source_kind: 'manual', panels: [{ draw_date: null, results: [], tags: [] }], document_warnings: [] }
  await db.batch([
    db.prepare("INSERT INTO import_batches (id, subject_id, status, created_at, created_by) VALUES (?, ?, 'open', ?, ?)").bind(batchId, sid, now, c.get('actor')),
    db.prepare(
      "INSERT INTO extraction_candidates (id, batch_id, subject_id, source_kind, status, document, privacy_mode, created_at, updated_at) VALUES (?, ?, ?, 'manual', 'ready', ?, 'local', ?, ?)",
    ).bind(candidateId, batchId, sid, JSON.stringify(doc), now, now),
  ])
  return c.json({ id: batchId }, 201)
})

app.get('/subjects/:sid/imports', async (c) => {
  const sid = await subjectId(c)
  const rows = await c.env.DB.prepare(
    `SELECT b.*, (SELECT json_group_array(json_object('id', x.id, 'status', x.status, 'filename', f.filename, 'source_kind', x.source_kind))
       FROM extraction_candidates x LEFT JOIN files f ON f.id = x.file_id WHERE x.batch_id = b.id) AS candidates_json
     FROM import_batches b WHERE b.subject_id = ? ORDER BY b.created_at DESC LIMIT 50`,
  )
    .bind(sid)
    .all<Record<string, unknown>>()
  return c.json(
    rows.results.map((b) => ({
      id: b.id,
      status: b.status,
      created_at: b.created_at,
      created_by: b.created_by,
      committed_at: b.committed_at,
      summary: parseJson(b.summary, null),
      candidates: parseJson(b.candidates_json, []),
    })),
  )
})

app.get('/subjects/:sid/imports/:bid', async (c) => {
  const sid = await subjectId(c)
  return c.json(await loadBatch(c.env.DB, sid, c.req.param('bid'), true))
})

app.put('/subjects/:sid/imports/:bid/candidates/:cid', async (c) => {
  const sid = await subjectId(c)
  const { document } = await c.req.json<{ document: ExtractionDocument }>()
  const row = await c.env.DB.prepare('SELECT status FROM extraction_candidates WHERE id = ? AND batch_id = ? AND subject_id = ?')
    .bind(c.req.param('cid'), c.req.param('bid'), sid)
    .first<{ status: string }>()
  if (!row) throw new HttpError(404, 'File not found in this import')
  if (row.status !== 'ready') throw new HttpError(409, `Cannot edit a ${row.status} file`)
  const annotated = await annotateDocument(c.env.DB, sid, document)
  await c.env.DB.prepare('UPDATE extraction_candidates SET document = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(annotated), nowIso(), c.req.param('cid')).run()
  return c.json({ document: annotated })
})

app.post('/subjects/:sid/imports/:bid/candidates/:cid/retry', async (c) => {
  const sid = await subjectId(c)
  if (!c.env.EXTRACTIONS) throw new HttpError(422, 'This deployment has no extraction queue.')
  const res = await c.env.DB.prepare("UPDATE extraction_candidates SET status = 'queued', error = NULL, attempts = 0, updated_at = ? WHERE id = ? AND subject_id = ? AND status = 'failed'")
    .bind(nowIso(), c.req.param('cid'), sid)
    .run()
  if (!res.meta.changes) throw new HttpError(409, 'Only failed files can be retried')
  await c.env.EXTRACTIONS.send({ candidateId: c.req.param('cid') })
  return c.json({ ok: true })
})

app.delete('/subjects/:sid/imports/:bid/candidates/:cid', async (c) => {
  const sid = await subjectId(c)
  await c.env.DB.prepare("UPDATE extraction_candidates SET status = 'discarded', updated_at = ? WHERE id = ? AND subject_id = ? AND status IN ('ready', 'failed')")
    .bind(nowIso(), c.req.param('cid'), sid)
    .run()
  return c.json({ ok: true })
})

app.post('/subjects/:sid/imports/:bid/commit', async (c) => {
  const sid = await subjectId(c)
  const summary = await commitBatch(c.env.DB, sid, c.req.param('bid'), c.get('actor'))
  return c.json(summary)
})

app.post('/subjects/:sid/imports/:bid/discard', async (c) => {
  const sid = await subjectId(c)
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE import_batches SET status = 'discarded' WHERE id = ? AND subject_id = ? AND status = 'open'").bind(c.req.param('bid'), sid),
    c.env.DB.prepare("UPDATE extraction_candidates SET status = 'discarded', updated_at = ? WHERE batch_id = ? AND status NOT IN ('committed')").bind(nowIso(), c.req.param('bid')),
  ])
  return c.json({ ok: true })
})

app.get('/subjects/:sid/files/:fid', async (c) => {
  const sid = await subjectId(c)
  const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ? AND subject_id = ?').bind(c.req.param('fid'), sid).first<Record<string, string>>()
  if (!file) throw new HttpError(404, 'File not found')
  const obj = await c.env.FILES.get(file.r2_key)
  if (!obj) throw new HttpError(404, 'File bytes not found')
  return new Response(obj.body, {
    headers: {
      'Content-Type': file.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${file.filename.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  })
})

// ─── Helpers ────────────────────────────────────────────────────────────

async function subjectId(c: { req: { param: (k: string) => string }; env: Env }): Promise<string> {
  const sid = c.req.param('sid')
  const row = await c.env.DB.prepare('SELECT id FROM subjects WHERE id = ?').bind(sid).first()
  if (!row) throw new HttpError(404, 'Person not found')
  return sid
}

async function loadBatch(db: D1Database, sid: string, batchId: string, withDocuments: boolean) {
  const batch = await db.prepare('SELECT * FROM import_batches WHERE id = ? AND subject_id = ?').bind(batchId, sid).first<Record<string, unknown>>()
  if (!batch) throw new HttpError(404, 'Import not found')
  const candidates = await db
    .prepare(
      `SELECT x.*, f.filename, f.mime_type FROM extraction_candidates x LEFT JOIN files f ON f.id = x.file_id
       WHERE x.batch_id = ? ORDER BY x.created_at`,
    )
    .bind(batchId)
    .all<Record<string, unknown>>()
  return {
    id: batch.id,
    status: batch.status,
    created_at: batch.created_at,
    created_by: batch.created_by,
    committed_at: batch.committed_at,
    summary: parseJson(batch.summary, null),
    candidates: candidates.results.map((x) => ({
      id: x.id,
      batch_id: x.batch_id,
      file_id: x.file_id,
      filename: x.filename ?? null,
      mime_type: x.mime_type ?? null,
      source_kind: x.source_kind,
      status: x.status,
      document: withDocuments ? parseJson(x.document, null) : null,
      model: x.model,
      privacy_mode: x.privacy_mode,
      error: typeof x.error === 'string' && x.error.startsWith('duplicate:') && x.status !== 'failed' ? null : x.error,
      created_at: x.created_at,
      updated_at: x.updated_at,
    })),
  }
}

async function saveExtraction(env: Env, candidateId: string, sid: string, doc: ExtractionDocument, model: string | null, privacy: string) {
  const annotated = await annotateDocument(env.DB, sid, doc)
  await env.DB.prepare(
    "UPDATE extraction_candidates SET status = 'ready', document = ?, model = ?, prompt_version = ?, privacy_mode = ?, error = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(JSON.stringify(annotated), model, model ? PROMPT_VERSION : null, privacy, nowIso(), candidateId)
    .run()
}

async function failCandidate(db: D1Database, candidateId: string, err: unknown) {
  const message = isPlanRefusal(err) ? PLAN_REFUSAL_MESSAGE : err instanceof Error ? err.message : String(err)
  await db.prepare("UPDATE extraction_candidates SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(message.slice(0, 500), nowIso(), candidateId).run()
}

async function createMarker(db: D1Database, spec: { name: string; category: string; default_units: string | null; long_name: string | null }) {
  const base = slugify(spec.name)
  let slug = base
  for (let i = 2; await db.prepare('SELECT 1 FROM lab_markers WHERE slug = ?').bind(slug).first(); i++) slug = `${base}-${i}`
  const id = newId('mk')
  const now = nowIso()
  await db.prepare('INSERT INTO lab_markers (id, slug, name, long_name, category, default_units, is_custom, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
    .bind(id, slug, spec.name, spec.long_name, spec.category, spec.default_units, 'active', now, now)
    .run()
  return markerOut((await db.prepare('SELECT * FROM lab_markers WHERE id = ?').bind(id).first())!)
}

function num(v: unknown): number | null {
  return v == null || v === '' ? null : Number(v)
}

function markerOut(m: Record<string, unknown>): Marker {
  return {
    id: String(m.id),
    slug: String(m.slug),
    name: String(m.name),
    long_name: (m.long_name as string) ?? null,
    loinc_code: (m.loinc_code as string) ?? null,
    category: String(m.category ?? 'uncategorized'),
    default_units: (m.default_units as string) ?? null,
    description: (m.description as string) ?? null,
    related_slugs: parseJson(m.related_slugs, []),
    default_ref_low: num(m.default_ref_low),
    default_ref_high: num(m.default_ref_high),
    default_ref_text: (m.default_ref_text as string) ?? null,
    is_custom: Boolean(m.is_custom),
    status: String(m.status),
  }
}

function resultOut(r: Record<string, unknown>): Result {
  return {
    id: String(r.id),
    panel_id: String(r.panel_id),
    marker_id: String(r.marker_id),
    draw_date: String(r.draw_date),
    draw_time: (r.draw_time as string) ?? null,
    raw_name: (r.raw_name as string) ?? null,
    raw_value: String(r.raw_value),
    comparator: (r.comparator as string) ?? null,
    value_numeric: num(r.value_numeric),
    raw_units: (r.raw_units as string) ?? null,
    reference_text: (r.reference_text as string) ?? null,
    ref_low: num(r.ref_low),
    ref_high: num(r.ref_high),
    lab_flag: (r.lab_flag as string) ?? null,
    flag_source: (r.flag_source as string) ?? null,
    notes: (r.notes as string) ?? null,
    corrected_at: (r.corrected_at as string) ?? null,
    facility: (r.facility as string) ?? null,
    panel_tags: parseJson(r.panel_tags, []),
  }
}

function panelOut(p: Record<string, unknown>): Panel {
  return {
    id: String(p.id),
    draw_date: String(p.draw_date),
    draw_time: (p.draw_time as string) ?? null,
    facility: (p.facility as string) ?? null,
    ordering_provider: (p.ordering_provider as string) ?? null,
    accession_number: (p.accession_number as string) ?? null,
    panel_name: (p.panel_name as string) ?? null,
    notes: (p.notes as string) ?? null,
    tags: parseJson(p.tags, []),
    source_file_id: (p.source_file_id as string) ?? null,
    source_filename: (p.source_filename as string) ?? null,
    result_count: Number(p.result_count ?? 0),
    flagged_count: Number(p.flagged_count ?? 0),
  }
}

function eventOut(e: Record<string, unknown>): TimelineEvent {
  const first = { start_date: String(e.start_date), end_date: (e.end_date as string) ?? null, ongoing: !e.end_date && Boolean(e.ongoing), note: (e.period_note as string) ?? null }
  return {
    id: String(e.id),
    kind: e.kind as EventKind,
    label: String(e.label),
    ...first,
    updated_at: String(e.updated_at),
    periods: [first, ...parseJson<EventPeriod[]>(e.additional_periods, [])],
    notes: (e.notes as string) ?? null,
    marker_ids: parseJson(e.marker_ids, []),
  }
}

// ─── Queue consumer: model extraction ───────────────────────────────────

const MAX_ATTEMPTS = 3


/** Returns 'retry' when the queue should redeliver the message later. */
async function processCandidate(env: Env, candidateId: string): Promise<'done' | 'retry'> {
  const db = env.DB
  const row = await db
    .prepare('SELECT x.*, f.r2_key, f.filename, f.mime_type FROM extraction_candidates x LEFT JOIN files f ON f.id = x.file_id WHERE x.id = ?')
    .bind(candidateId)
    .first<Record<string, string | null>>()
  if (!row || (row.status !== 'queued' && row.status !== 'processing')) return 'done'
  await db.prepare("UPDATE extraction_candidates SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?").bind(nowIso(), candidateId).run()
  const attempt = Number(row.attempts ?? 0) + 1
  try {
    const obj = row.r2_key ? await env.FILES.get(row.r2_key) : null
    if (!obj) throw new Error('Uploaded file is missing')
    const bytes = await obj.arrayBuffer()
    const out = await extractWithModel(env, row.source_kind as 'pdf' | 'image', bytes, row.filename ?? 'upload', row.mime_type ?? '')
    const dup = row.error?.startsWith('duplicate:') ? row.error.slice(10) : null
    if (dup) out.document.document_warnings.unshift(`This file was already uploaded on ${dup}.`)
    await saveExtraction(env, candidateId, String(row.subject_id), out.document, out.model, out.privacyMode)
    return 'done'
  } catch (err) {
    console.error('extraction failed', candidateId, attempt, logMessage(err))
    if (isTransient(err) && attempt < MAX_ATTEMPTS) {
      await db.prepare("UPDATE extraction_candidates SET status = 'queued', updated_at = ? WHERE id = ?").bind(nowIso(), candidateId).run()
      return 'retry'
    }
    await failCandidate(db, candidateId, err)
    return 'done'
  }
}

export default {
  fetch(request, env, ctx) {
    // run_worker_first sends only /api/* and /mcp here; everything else is static assets.
    if (isMcpRequest(new URL(request.url))) return mcpFetch(request, env, ctx, app.fetch)
    return app.fetch(request, env, ctx)
  },
  async queue(batch: MessageBatch<{ candidateId: string }>, env: Env) {
    for (const message of batch.messages) {
      const outcome = await processCandidate(env, message.body.candidateId)
      if (outcome === 'retry') message.retry({ delaySeconds: 20 * message.attempts })
      else message.ack()
    }
  },
} satisfies ExportedHandler<Env, { candidateId: string }>
