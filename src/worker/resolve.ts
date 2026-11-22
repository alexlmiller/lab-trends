// Marker resolution for extraction review: map each extracted row to an
// existing marker (subject alias → global alias → slug → name) or propose a
// new custom marker. Also annotates rows that already exist for that draw and
// panels that look like a saved draw dated a few days off.
import { normalizeCategory } from '../shared/categories'
import { normalizeAlias, slugify } from '../shared/markers'
import { dateFromDay, dayNumber } from '../shared/dates'
import { parseLabValue, sameReportedValue } from '../shared/semantics'
import type { ExtractedPanel, ExtractionDocument } from '../shared/types'

type MarkerRow = { id: string; slug: string; name: string; long_name: string | null; category: string; status: string; merged_into_id: string | null }

export type MarkerIndex = {
  byId: Map<string, MarkerRow>
  lookup: (rawName: string) => { id: string; match: 'slug' | 'alias' } | null
}

export async function loadMarkerIndex(db: D1Database, subjectId: string): Promise<MarkerIndex> {
  const [markers, aliases] = await db.batch([
    db.prepare('SELECT id, slug, name, long_name, category, status, merged_into_id FROM lab_markers'),
    db.prepare("SELECT marker_id, normalized_name, scope FROM lab_marker_aliases WHERE scope IN ('global', ?)").bind(subjectId),
  ])
  const byId = new Map<string, MarkerRow>()
  for (const m of markers.results as MarkerRow[]) byId.set(m.id, m)
  const follow = (id: string) => {
    let current = byId.get(id)
    for (let i = 0; current && current.status === 'merged' && current.merged_into_id && i < 5; i++) current = byId.get(current.merged_into_id)
    return current && current.status !== 'archived' ? current.id : null
  }
  const subjectAlias = new Map<string, string>()
  const globalAlias = new Map<string, string>()
  for (const a of aliases.results as { marker_id: string; normalized_name: string; scope: string }[]) {
    ;(a.scope === 'global' ? globalAlias : subjectAlias).set(a.normalized_name, a.marker_id)
  }
  const bySlug = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const m of byId.values()) {
    bySlug.set(m.slug, m.id)
    for (const name of [m.name, m.long_name]) {
      const key = name ? normalizeAlias(name) : ''
      if (key) byName.set(key, m.id)
    }
  }
  return {
    byId,
    lookup(rawName) {
      // A name with no letters or digits has nothing to match on; it never borrows another test's marker.
      const norm = normalizeAlias(rawName)
      if (!norm) return null
      for (const map of [subjectAlias, globalAlias]) {
        const hit = map.get(norm)
        const id = hit ? follow(hit) : null
        if (id) return { id, match: 'alias' }
      }
      const slug = slugify(rawName)
      const slugHit = (slug ? bySlug.get(slug) : undefined) ?? byName.get(norm)
      const id = slugHit ? follow(slugHit) : null
      return id ? { id, match: 'slug' } : null
    },
  }
}

/** Fill marker suggestions and duplicate annotations in place. */
export async function annotateDocument(db: D1Database, subjectId: string, doc: ExtractionDocument, index?: MarkerIndex): Promise<ExtractionDocument> {
  const idx = index ?? (await loadMarkerIndex(db, subjectId))
  const pref = await db.prepare('SELECT hidden_marker_ids FROM preferences WHERE subject_id = ?').bind(subjectId).first<{ hidden_marker_ids: string }>()
  let hidden = new Set<string>()
  try {
    hidden = new Set(JSON.parse(pref?.hidden_marker_ids ?? '[]') as string[])
  } catch {
    /* default: none hidden */
  }
  const dates = [...new Set(doc.panels.map((p) => p.draw_date).filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d))))]
  const existing = new Map<string, { result_id: string; raw_value: string; raw_units: string | null }>()
  const byDate: SavedByDate = new Map()
  if (dates.length) {
    const days = dates.map(dayNumber)
    const rows = await db
      .prepare(
        `SELECT r.id, r.panel_id, r.marker_id, r.raw_value, r.raw_units, p.draw_date FROM lab_results r JOIN lab_panels p ON p.id = r.panel_id
         WHERE r.subject_id = ? AND p.deleted_at IS NULL AND p.draw_date BETWEEN ? AND ?`,
      )
      .bind(subjectId, dateFromDay(Math.min(...days) - NEAR_DAYS), dateFromDay(Math.max(...days) + NEAR_DAYS))
      .all<{ id: string; panel_id: string; marker_id: string; raw_value: string; raw_units: string | null; draw_date: string }>()
    for (const r of rows.results) {
      existing.set(`${r.draw_date}|${r.marker_id}`, { result_id: r.id, raw_value: r.raw_value, raw_units: r.raw_units })
      const day = byDate.get(r.draw_date) ?? { panel_id: r.panel_id, values: new Map<string, string>() }
      day.values.set(r.marker_id, r.raw_value)
      byDate.set(r.draw_date, day)
    }
  }
  for (const panel of doc.panels) {
    // Category for proposed new markers when the report gives none: the panel's dominant one.
    const cats = new Map<string, number>()
    for (const row of panel.results) {
      const hit = row.marker_id ? idx.byId.get(row.marker_id) : row.match !== 'new' ? idx.byId.get(idx.lookup(row.raw_name)?.id ?? '') : undefined
      const cat = hit?.category ?? null
      if (cat) cats.set(cat, (cats.get(cat) ?? 0) + 1)
    }
    const dominant = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'uncategorized'
    for (const row of panel.results) {
      const manual = row.match === 'manual' && row.marker_id && idx.byId.has(row.marker_id)
      if (!manual && row.match !== 'new') {
        const hit = idx.lookup(row.raw_name)
        if (hit) {
          row.marker_id = hit.id
          row.match = hit.match
          row.new_marker = null
        } else {
          row.marker_id = null
          row.match = 'new'
        }
      }
      if (row.match === 'new' && !row.new_marker) {
        const reported = normalizeCategory(row.raw_test_category)
        row.new_marker = { name: row.raw_name.trim(), category: reported === 'uncategorized' ? dominant : reported, default_units: row.raw_units ?? null }
      }
      const prior = row.marker_id && panel.draw_date ? existing.get(`${panel.draw_date}|${row.marker_id}`) : undefined
      const before = row.existing?.result_id ?? null
      row.existing = prior ?? null
      // Defaults, also reapplied when a date change lines the row up with a different saved result:
      // leave out removed markers and anything already saved. A different value is more often a
      // misread than a lab correction, so the saved one is kept unless the row is ticked.
      if (row.include === undefined || (prior && prior.result_id !== before)) {
        const removed = Boolean(row.marker_id && hidden.has(row.marker_id))
        row.include = !removed && !prior
        if (removed && !row.warnings?.includes(REMOVED_NOTE)) row.warnings = [...(row.warnings ?? []), REMOVED_NOTE]
      }
    }
    panel.near_duplicate = nearDuplicate(panel, byDate)
  }
  markSameDayRepeats(doc)
  return doc
}

const REPEAT_NOTE = 'Also listed as '

/** Two different values for one test on one date: only one can be saved, so the later row says so. */
function markSameDayRepeats(doc: ExtractionDocument) {
  const first = new Map<string, string>()
  for (const panel of doc.panels) {
    for (const row of panel.results) {
      if (row.warnings?.some((w) => w.startsWith(REPEAT_NOTE))) row.warnings = row.warnings.filter((w) => !w.startsWith(REPEAT_NOTE))
      const marker = row.marker_id ?? (row.new_marker ? `new:${normalizeAlias(row.new_marker.name) || row.new_marker.name}` : null)
      if (!marker || !panel.draw_date || row.include === false) continue
      const key = `${panel.draw_date}|${marker}`
      const earlier = first.get(key)
      if (earlier === undefined) first.set(key, row.raw_value)
      else if (!sameReportedValue(earlier, row.raw_value)) {
        row.warnings = [...(row.warnings ?? []), `${REPEAT_NOTE}${earlier} on this date. One value per test per date is saved, so untick the one to leave out.`]
      }
    }
  }
}

/** Saved results by draw date: one draw's id and its values by marker. */
export type SavedByDate = Map<string, { panel_id: string; values: Map<string, string> }>

const REMOVED_NOTE = 'You removed this marker, so it is left out. Tick to bring it back.'
/** How far apart two dates can be and still be the same draw (collection vs result date). */
const NEAR_DAYS = 5

/**
 * A saved draw a few days off that has the same numeric values for most of
 * the tests both share: likely the same draw dated by result rather than
 * collection. Text values (Negative, Clear) repeat too often to count.
 */
export function nearDuplicate(panel: ExtractedPanel, byDate: SavedByDate): ExtractedPanel['near_duplicate'] {
  if (!panel.draw_date || !/^\d{4}-\d{2}-\d{2}$/.test(panel.draw_date)) return null
  const rows = panel.results.filter((r) => r.marker_id && parseLabValue(r.raw_value).numeric != null)
  const compare = (date: string) => {
    const saved = byDate.get(date)?.values
    const shared = saved ? rows.filter((r) => saved.has(r.marker_id!)) : []
    return { compared: shared.length, matching: shared.filter((r) => sameReportedValue(saved!.get(r.marker_id!)!, r.raw_value)).length }
  }
  const own = compare(panel.draw_date).matching
  const day = dayNumber(panel.draw_date)
  let best: { draw_date: string; matching: number; compared: number } | null = null
  for (let d = -NEAR_DAYS; d <= NEAR_DAYS; d++) {
    if (!d) continue
    const date = dateFromDay(day + d)
    const c = compare(date)
    if (c.matching >= 2 && c.matching >= c.compared * 0.6 && c.matching > own && (!best || c.matching > best.matching)) best = { draw_date: date, ...c }
  }
  return best && { ...best, panel_id: byDate.get(best.draw_date)!.panel_id }
}
