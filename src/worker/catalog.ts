// The test catalog (lab_markers and the spellings everyone shares) changes
// rarely and every page needs it, so each isolate keeps a copy for a minute
// instead of reading it from D1 on every request.
import { normalizeCategory } from '../shared/categories'
import { slugify } from '../shared/markers'
import type { Marker } from '../shared/types'
import { newId, nowIso } from './lib'
import { MARKER_COLUMNS, markerOut } from './rows'

export type Catalog = { markers: Map<string, Marker>; /** Spellings by marker id, shared by everyone. */ aliases: Map<string, string[]>; expires: number }

const TTL_MS = 60_000
let cached: Catalog | null = null

/** Drop this isolate's copy after a write to the catalog. */
export function forgetCatalog() {
  cached = null
}

/**
 * The catalog. `needs` are marker ids the caller is about to show: an id the
 * cached copy lacks was created in another isolate, so the copy is reloaded.
 */
export async function loadCatalog(db: D1Database, needs: Iterable<string> = []): Promise<Catalog> {
  if (cached && cached.expires > Date.now()) {
    let complete = true
    for (const id of needs) {
      if (!cached.markers.has(id)) {
        complete = false
        break
      }
    }
    if (complete) return cached
  }
  const [markers, aliases] = await db.batch([
    db.prepare(`SELECT ${MARKER_COLUMNS} FROM lab_markers`),
    db.prepare("SELECT marker_id, source_name FROM lab_marker_aliases WHERE scope = 'global'"),
  ])
  const aliasMap = new Map<string, string[]>()
  for (const a of aliases.results as { marker_id: string; source_name: string }[]) {
    const list = aliasMap.get(a.marker_id)
    if (list) list.push(a.source_name)
    else aliasMap.set(a.marker_id, [a.source_name])
  }
  cached = { markers: new Map((markers.results as Record<string, unknown>[]).map((m) => [String(m.id), markerOut(m)])), aliases: aliasMap, expires: Date.now() + TTL_MS }
  return cached
}

export async function createMarker(db: D1Database, spec: { name: string; category: string; default_units: string | null; long_name: string | null }): Promise<Marker> {
  const base = slugify(spec.name) || 'marker'
  const taken = new Set((await db.prepare('SELECT slug FROM lab_markers WHERE slug = ?1 OR slug LIKE ?2').bind(base, `${base}-%`).all<{ slug: string }>()).results.map((r) => r.slug))
  let slug = base
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
  const id = newId('mk')
  const now = nowIso()
  const row = await db
    .prepare(
      `INSERT INTO lab_markers (id, slug, name, long_name, category, default_units, is_custom, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?) RETURNING ${MARKER_COLUMNS}`,
    )
    .bind(id, slug, spec.name, spec.long_name, normalizeCategory(spec.category), spec.default_units, now, now)
    .first<Record<string, unknown>>()
  forgetCatalog()
  return markerOut(row!)
}
