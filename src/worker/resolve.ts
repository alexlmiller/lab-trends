// Marker resolution for extraction review: map each extracted row to an
// existing marker (subject alias → global alias → slug → name) or propose a
// new custom marker. Also annotates rows that already exist for that draw and
// panels that look like a saved draw dated a few days off.
import { normalizeCategory } from '../shared/categories'
import { normalizeAlias, slugify } from '../shared/markers'
import { dateFromDay, dayNumber, isValidDate } from '../shared/dates'
import { parseLabValue, sameReportedValue } from '../shared/semantics'
import type { ExtractedPanel, ExtractionDocument, Marker } from '../shared/types'
import { loadCatalog, type Catalog } from './catalog'
import { parseJson } from './lib'

export type MarkerIndex = {
  byId: Map<string, Marker>
  lookup: (rawName: string, units?: string | null) => { id: string; match: 'slug' | 'alias' } | null
}

/** What a differential's units say about a bare name: "Neutrophils" in % is the percentage, in x10E3/uL the count. */
function unitHint(units: string | null | undefined): 'percent' | 'absolute' | null {
  const u = (units ?? '').trim().toLowerCase()
  if (u === '%') return 'percent'
  return /\/\s*(?:[uµμ]l|mcl|mm3|cumm)\b|10\s*[\^*e]\s*\d+\s*\/\s*l\b/.test(u) ? 'absolute' : null
}

/** Name lookup over the shared catalog plus the spellings one person's reports have used. */
export function markerIndex(catalog: Catalog, subjectAlias: Map<string, string>): MarkerIndex {
  const byId = catalog.markers
  const follow = (id: string) => {
    let current = byId.get(id)
    for (let i = 0; current && current.status === 'merged' && catalog.mergedInto.has(current.id) && i < 5; i++) current = byId.get(catalog.mergedInto.get(current.id)!)
    return current && current.status !== 'archived' ? current.id : null
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
    lookup(rawName, units) {
      // A name with no letters or digits has nothing to match on; it never borrows another test's marker.
      const norm = normalizeAlias(rawName)
      if (!norm) return null
      const hint = unitHint(units)
      for (const key of hint ? [`${norm} ${hint}`, norm] : [norm]) {
        for (const map of [subjectAlias, catalog.keys]) {
          const hit = map.get(key)
          const id = hit ? follow(hit) : null
          if (id) return { id, match: 'alias' }
        }
      }
      const slug = slugify(rawName)
      const slugHit = (slug ? bySlug.get(slug) : undefined) ?? byName.get(norm)
      const id = slugHit ? follow(slugHit) : null
      return id ? { id, match: 'slug' } : null
    },
  }
}

type SavedRow = { id: string; panel_id: string; marker_id: string; raw_value: string; raw_units: string | null; draw_date: string }

/** Fill marker suggestions and duplicate annotations in place: one round trip, reading only draws near the draft's dates. */
export async function annotateDocument(db: D1Database, subjectId: string, doc: ExtractionDocument): Promise<ExtractionDocument> {
  const days = [...new Set(doc.panels.map((p) => p.draw_date).filter(isValidDate))].map(dayNumber)
  // Without a date there is nothing saved to compare with; an empty range keeps the batch the same shape.
  const [from, to] = days.length ? [dateFromDay(Math.min(...days) - NEAR_DAYS), dateFromDay(Math.max(...days) + NEAR_DAYS)] : ['9', '0']
  const [catalog, [aliases, prefs, saved]] = await Promise.all([
    loadCatalog(db),
    db.batch([
      db.prepare('SELECT normalized_name, marker_id FROM lab_marker_aliases WHERE scope = ?').bind(subjectId),
      db.prepare('SELECT hidden_marker_ids FROM preferences WHERE subject_id = ?').bind(subjectId),
      db
        .prepare(
          `SELECT r.id, r.panel_id, r.marker_id, r.raw_value, r.raw_units, p.draw_date FROM lab_panels p JOIN lab_results r ON r.panel_id = p.id
           WHERE p.subject_id = ? AND p.deleted_at IS NULL AND p.draw_date BETWEEN ? AND ?`,
        )
        .bind(subjectId, from, to),
    ]),
  ])
  const idx = markerIndex(catalog, new Map((aliases.results as { normalized_name: string; marker_id: string }[]).map((a) => [a.normalized_name, a.marker_id])))
  const hidden = new Set(parseJson<string[]>((prefs.results[0] as { hidden_marker_ids?: string } | undefined)?.hidden_marker_ids, []))
  const existing = new Map<string, { result_id: string; raw_value: string; raw_units: string | null }>()
  const byDate: SavedByDate = new Map()
  for (const r of saved.results as SavedRow[]) {
    existing.set(`${r.draw_date}|${r.marker_id}`, { result_id: r.id, raw_value: r.raw_value, raw_units: r.raw_units })
    const day = byDate.get(r.draw_date) ?? { panel_id: r.panel_id, values: new Map<string, string>() }
    day.values.set(r.marker_id, r.raw_value)
    byDate.set(r.draw_date, day)
  }
  for (const panel of doc.panels) {
    // Category for proposed new markers when the report gives none: the panel's dominant one.
    const cats = new Map<string, number>()
    for (const row of panel.results) {
      const hit = row.marker_id ? idx.byId.get(row.marker_id) : row.match !== 'new' ? idx.byId.get(idx.lookup(row.raw_name, row.raw_units)?.id ?? '') : undefined
      const cat = hit?.category ?? null
      if (cat) cats.set(cat, (cats.get(cat) ?? 0) + 1)
    }
    const dominant = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'uncategorized'
    for (const row of panel.results) {
      const manual = row.match === 'manual' && row.marker_id && idx.byId.has(row.marker_id)
      if (!manual && row.match !== 'new') {
        const hit = idx.lookup(row.raw_name, row.raw_units)
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
