// Commit reviewed extraction candidates into lab_panels / lab_results in one
// atomic D1 batch. Rows that duplicate an existing value are skipped; rows the
// user chose to keep over an existing different value replace it with a
// revision record.
import { normalizeAlias, slugify } from '../shared/markers'
import { deriveResultFields, sameReportedValue } from '../shared/semantics'
import type { CommitSummary, ExtractionDocument } from '../shared/types'
import { HttpError, newId, nowIso, parseJson } from './lib'

type CandidateRow = { id: string; file_id: string | null; status: string; document: string | null }

export async function commitBatch(db: D1Database, subjectId: string, batchId: string, email: string): Promise<CommitSummary> {
  const batch = await db.prepare('SELECT id, status FROM import_batches WHERE id = ? AND subject_id = ?').bind(batchId, subjectId).first<{ status: string }>()
  if (!batch) throw new HttpError(404, 'Import not found')
  if (batch.status !== 'open') throw new HttpError(409, `Import is already ${batch.status}`)
  const candidates = (
    await db.prepare('SELECT id, file_id, status, document FROM extraction_candidates WHERE batch_id = ?').bind(batchId).all<CandidateRow>()
  ).results
  if (candidates.some((c) => c.status === 'queued' || c.status === 'processing')) throw new HttpError(409, 'Some files are still being read')
  const ready = candidates.filter((c) => c.status === 'ready')
  if (!ready.length) throw new HttpError(400, 'Nothing to commit')

  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  const summary: CommitSummary = { panels_created: 0, panels_merged: 0, results_created: 0, results_replaced: 0, duplicates_skipped: 0, markers_created: 0, skipped: 0 }

  // Existing slugs (to keep new custom slugs unique) and markers by id.
  const markerRows = (await db.prepare('SELECT id, slug FROM lab_markers').all<{ id: string; slug: string }>()).results
  const slugs = new Set(markerRows.map((m) => m.slug))
  const markerIds = new Set(markerRows.map((m) => m.id))
  const createdByName = new Map<string, string>()
  const aliasRows = (
    await db.prepare("SELECT normalized_name FROM lab_marker_aliases WHERE scope IN ('global', ?)").bind(subjectId).all<{ normalized_name: string }>()
  ).results
  const knownAliases = new Set(aliasRows.map((a) => a.normalized_name))

  type PanelRef = { id: string; facility: string | null; tags: string[] }
  const panelsByDate = new Map<string, PanelRef[]>()
  for (const p of (
    await db
      .prepare('SELECT id, draw_date, facility, tags FROM lab_panels WHERE subject_id = ? AND deleted_at IS NULL')
      .bind(subjectId)
      .all<{ id: string; draw_date: string; facility: string | null; tags: string }>()
  ).results) {
    const list = panelsByDate.get(p.draw_date) ?? []
    list.push({ id: p.id, facility: p.facility, tags: parseJson<string[]>(p.tags, []) })
    panelsByDate.set(p.draw_date, list)
  }
  const existingResults = new Map<string, { id: string; raw_value: string; json: string }>()
  for (const r of (
    await db.prepare('SELECT * FROM lab_results WHERE subject_id = ?').bind(subjectId).all<Record<string, unknown>>()
  ).results) {
    existingResults.set(`${r.panel_id}|${r.marker_id}`, { id: String(r.id), raw_value: String(r.raw_value), json: JSON.stringify(r) })
  }

  const committedMarkers = new Set<string>()
  const resolveMarker = (row: ExtractionDocument['panels'][number]['results'][number]): string => {
    if (row.marker_id && markerIds.has(row.marker_id) && row.match !== 'new') return row.marker_id
    const spec = row.new_marker ?? { name: row.raw_name, category: row.raw_test_category ?? 'uncategorized', default_units: row.raw_units ?? null }
    const key = normalizeAlias(spec.name)
    const already = createdByName.get(key)
    if (already) return already
    let slug = slugify(spec.name)
    for (let i = 2; slugs.has(slug); i++) slug = `${slugify(spec.name)}-${i}`
    slugs.add(slug)
    const id = newId('mk')
    markerIds.add(id)
    createdByName.set(key, id)
    statements.push(
      db
        .prepare(
          `INSERT INTO lab_markers (id, slug, name, category, default_units, is_custom, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
        )
        .bind(id, slug, spec.name.trim(), spec.category || 'uncategorized', spec.default_units, now, now),
    )
    summary.markers_created++
    return id
  }

  for (const candidate of ready) {
    const doc = parseJson<ExtractionDocument | null>(candidate.document, null)
    if (!doc) continue
    for (const panel of doc.panels) {
      const included = panel.results.filter((r) => r.include !== false)
      summary.skipped += panel.results.length - included.length
      const tagsOnly = !included.length && Boolean(panel.tags?.length) && Boolean(panel.draw_date)
      if (!included.length && !tagsOnly) continue
      if (!panel.draw_date || !/^\d{4}-\d{2}-\d{2}$/.test(panel.draw_date)) throw new HttpError(400, 'Every panel needs a collection date before committing')
      const sameDay = panelsByDate.get(panel.draw_date) ?? []
      const facility = panel.facility?.trim() || null
      // One collection date is one draw: prefer a facility match, else merge into that day's draw.
      let target = sameDay.find((p) => p.facility && facility && p.facility.toLowerCase() === facility.toLowerCase()) ?? sameDay[0]
      if (tagsOnly && !target) continue
      if (target) {
        if (included.length) summary.panels_merged++
        const tags = [...new Set([...target.tags, ...(panel.tags ?? [])])]
        if (tags.length !== target.tags.length || (!target.facility && facility)) {
          target.tags = tags
          target.facility = target.facility ?? facility
          statements.push(
            db
              .prepare('UPDATE lab_panels SET tags = ?, facility = COALESCE(facility, ?), updated_at = ? WHERE id = ?')
              .bind(JSON.stringify(tags), facility, now, target.id),
          )
        }
      } else {
        target = { id: newId('pn'), facility, tags: panel.tags ?? [] }
        summary.panels_created++
        sameDay.push(target)
        panelsByDate.set(panel.draw_date, sameDay)
        statements.push(
          db
            .prepare(
              `INSERT INTO lab_panels (id, subject_id, draw_date, draw_time, facility, ordering_provider, accession_number, panel_name, tags,
                 source_candidate_id, source_file_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              target.id, subjectId, panel.draw_date, panel.draw_time ?? null, facility, panel.ordering_provider ?? null,
              panel.accession_number ?? null, panel.panel_name ?? null, JSON.stringify(panel.tags ?? []),
              candidate.id, candidate.file_id, now, now,
            ),
        )
      }
      const seenInPanel = new Set<string>()
      for (const row of included) {
        const markerId = resolveMarker(row)
        committedMarkers.add(markerId)
        if (seenInPanel.has(markerId)) {
          summary.duplicates_skipped++
          continue
        }
        seenInPanel.add(markerId)
        const norm = normalizeAlias(row.raw_name)
        if (norm && !knownAliases.has(norm)) {
          knownAliases.add(norm)
          statements.push(
            db
              .prepare('INSERT OR IGNORE INTO lab_marker_aliases (id, marker_id, source_name, normalized_name, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
              .bind(newId('al'), markerId, row.raw_name.trim(), norm, subjectId, now),
          )
        }
        const derived = deriveResultFields(row.raw_value, row.reference_text, row.lab_flag)
        const prior = existingResults.get(`${target.id}|${markerId}`)
        const values = [
          row.raw_name.trim(), row.raw_value.trim(), derived.comparator, derived.value_numeric, derived.value_text, row.raw_units?.trim() || null,
          derived.reference_text, derived.ref_low, derived.ref_high, derived.lab_flag, derived.flag_source,
          row.source_excerpt ?? null, row.source_row_id ?? null,
        ]
        if (prior) {
          if (sameReportedValue(prior.raw_value, row.raw_value)) {
            summary.duplicates_skipped++
            continue
          }
          statements.push(
            db
              .prepare(
                `UPDATE lab_results SET raw_name = ?, raw_value = ?, comparator = ?, value_numeric = ?, value_text = ?, raw_units = ?, reference_text = ?,
                   ref_low = ?, ref_high = ?, lab_flag = ?, flag_source = ?, source_excerpt = ?, source_row_id = ?, updated_at = ? WHERE id = ?`,
              )
              .bind(...values, now, prior.id),
            db
              .prepare('INSERT INTO result_revisions (id, result_id, action, before_json, after_json, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .bind(newId('rv'), prior.id, 'import_replace', prior.json, JSON.stringify({ raw_value: row.raw_value, candidate_id: candidate.id }), now, email),
          )
          summary.results_replaced++
        } else {
          const id = newId('rs')
          existingResults.set(`${target.id}|${markerId}`, { id, raw_value: row.raw_value, json: '{}' })
          statements.push(
            db
              .prepare(
                `INSERT INTO lab_results (raw_name, raw_value, comparator, value_numeric, value_text, raw_units, reference_text, ref_low, ref_high,
                   lab_flag, flag_source, source_excerpt, source_row_id, id, panel_id, subject_id, marker_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(...values, id, target.id, subjectId, markerId, now, now),
          )
          summary.results_created++
        }
      }
    }
    statements.push(db.prepare("UPDATE extraction_candidates SET status = 'committed', updated_at = ? WHERE id = ?").bind(now, candidate.id))
  }
  for (const c of candidates.filter((c) => c.status === 'failed')) {
    statements.push(db.prepare("UPDATE extraction_candidates SET status = 'discarded', updated_at = ? WHERE id = ?").bind(now, c.id))
  }
  // A removed marker that the user ticked back in during review is wanted again.
  const pref = await db.prepare('SELECT hidden_marker_ids FROM preferences WHERE subject_id = ?').bind(subjectId).first<{ hidden_marker_ids: string }>()
  const hidden = parseJson<string[]>(pref?.hidden_marker_ids, [])
  const stillHidden = hidden.filter((id) => !committedMarkers.has(id))
  if (stillHidden.length !== hidden.length) {
    statements.push(db.prepare('UPDATE preferences SET hidden_marker_ids = ?, updated_at = ? WHERE subject_id = ?').bind(JSON.stringify(stillHidden), now, subjectId))
  }
  statements.push(
    db
      .prepare("UPDATE import_batches SET status = 'committed', committed_at = ?, committed_by = ?, summary = ? WHERE id = ?")
      .bind(now, email, JSON.stringify(summary), batchId),
  )
  await db.batch(statements)
  return summary
}
