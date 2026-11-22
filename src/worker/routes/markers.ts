// The test catalog: every test anyone here has results for, shared by all people.
import { Hono } from 'hono'
import { normalizeCategory } from '../../shared/categories'
import { normalizeAlias } from '../../shared/markers'
import { createMarker, forgetCatalog, loadCatalog } from '../catalog'
import { HttpError, jsonBody, newId, nowIso, text, type AppEnv } from '../lib'
import { MARKER_COLUMNS, markerOut } from '../rows'

export const markers = new Hono<AppEnv>()

markers.get('/markers', async (c) => {
  const catalog = await loadCatalog(c.env.DB)
  const active = [...catalog.markers.values()].filter((m) => m.status === 'active').sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  return c.json(active.map((m) => ({ ...m, aliases: catalog.aliases.get(m.id) ?? [] })))
})

markers.post('/markers', async (c) => {
  const body = await jsonBody(c)
  const name = text(body.name, 'Name', 120)
  if (!name) throw new HttpError(400, 'Name is required')
  const marker = await createMarker(c.env.DB, {
    name,
    category: text(body.category, 'Category', 60) ?? 'uncategorized',
    default_units: text(body.default_units, 'Units', 60),
    long_name: text(body.long_name, 'Full name', 200),
  })
  return c.json(marker, 201)
})

markers.patch('/markers/:id', async (c) => {
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const existing = await c.env.DB.prepare(`SELECT ${MARKER_COLUMNS} FROM lab_markers WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  if (!existing) throw new HttpError(404, 'Marker not found')
  const given = (key: string, field: string, max: number) => (key in body ? text(body[key], field, max) : (existing[key] as string | null))
  const category = text(body.category, 'Category', 60)
  const saved = await c.env.DB.prepare(
    `UPDATE lab_markers SET name = ?, long_name = ?, category = ?, default_units = ?, description = ?, updated_at = ? WHERE id = ? RETURNING ${MARKER_COLUMNS}`,
  )
    .bind(
      text(body.name, 'Name', 120) ?? existing.name,
      given('long_name', 'Full name', 200),
      category ? normalizeCategory(category) : existing.category,
      given('default_units', 'Units', 60),
      given('description', 'Description', 2_000),
      nowIso(),
      id,
    )
    .first<Record<string, unknown>>()
  forgetCatalog()
  return c.json(markerOut(saved!))
})

/** Merge `id` into `into_id`: results and aliases move; conflicts on the same draw are reported, not dropped. */
markers.post('/markers/:id/merge', async (c) => {
  const id = c.req.param('id')
  const into = text((await jsonBody(c)).into_id, 'Marker', 60)
  if (!into || into === id) throw new HttpError(400, 'Choose a different marker to merge into')
  const db = c.env.DB
  const [found, conflicts] = await db.batch([
    db.prepare('SELECT id, name FROM lab_markers WHERE id IN (?, ?)').bind(id, into),
    db.prepare('SELECT COUNT(*) AS n FROM lab_results a JOIN lab_results b ON a.panel_id = b.panel_id AND b.marker_id = ? WHERE a.marker_id = ?').bind(into, id),
  ])
  const from = (found.results as { id: string; name: string }[]).find((m) => m.id === id)
  if (!from || found.results.length !== 2) throw new HttpError(404, 'Marker not found')
  const clashes = Number((conflicts.results[0] as { n: number }).n)
  if (clashes) throw new HttpError(409, `${clashes} draw(s) have both markers. Delete or correct those results first.`)
  const now = nowIso()
  const key = normalizeAlias(from.name)
  const moved = await db.batch([
    db.prepare('UPDATE lab_results SET marker_id = ?, updated_at = ? WHERE marker_id = ?').bind(into, now, id),
    db.prepare('UPDATE OR IGNORE lab_marker_aliases SET marker_id = ? WHERE marker_id = ?').bind(into, id),
    ...(key
      ? [db.prepare("INSERT OR IGNORE INTO lab_marker_aliases (id, marker_id, source_name, normalized_name, scope, created_at) VALUES (?, ?, ?, ?, 'global', ?)").bind(newId('al'), into, from.name, key, now)]
      : []),
    db.prepare('UPDATE personal_targets SET marker_id = ? WHERE marker_id = ? AND subject_id NOT IN (SELECT subject_id FROM personal_targets WHERE marker_id = ?)').bind(into, id, into),
    db.prepare("UPDATE lab_markers SET status = 'merged', merged_into_id = ?, updated_at = ? WHERE id = ?").bind(into, now, id),
  ])
  forgetCatalog()
  return c.json({ moved_results: moved[0].meta.changes })
})
