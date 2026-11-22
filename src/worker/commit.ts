// Commit reviewed extraction candidates into lab_panels / lab_results in one
// atomic D1 batch. The import is claimed first, so a second commit of the same
// import (a double click, an agent's retry) stops instead of writing it twice.
// Rows that repeat a saved value are skipped. Rows the user chose to keep over a
// different saved value replace it, and the old row goes to the revision log.
// Two different values for one test on one date within the import are never
// resolved silently: the first is kept and the other is reported.
import { isValidDate } from '../shared/dates'
import { normalizeAlias, slugify } from '../shared/markers'
import { deriveResultFields, sameReportedValue } from '../shared/semantics'
import type { CommitSummary, ExtractionDocument } from '../shared/types'
import { HttpError, newId, nowIso, parseJson } from './lib'
import { RESULT_JSON } from './rows'

type CandidateRow = { id: string; file_id: string | null; status: string; document: string | null }

/** A claim older than this was left by a commit that died, so the import may be committed again. */
const CLAIM_MS = 2 * 60_000
const MAX_REPORTED_CONFLICTS = 50

export type CommitOutcome = { summary: CommitSummary; /** Uploads that no draw points at once the import is saved. */ unusedFileIds: string[] }

export async function commitBatch(db: D1Database, subjectId: string, batchId: string, email: string): Promise<CommitOutcome> {
  const now = nowIso()
  const claim = await db
    .prepare(
      `UPDATE import_batches SET status = 'committing', committed_at = ?1 WHERE id = ?2 AND subject_id = ?3
         AND (status = 'open' OR (status = 'committing' AND committed_at < ?4))`,
    )
    .bind(now, batchId, subjectId, new Date(Date.now() - CLAIM_MS).toISOString())
    .run()
  if (!claim.meta.changes) {
    const batch = await db.prepare('SELECT status FROM import_batches WHERE id = ? AND subject_id = ?').bind(batchId, subjectId).first<{ status: string }>()
    if (!batch) throw new HttpError(404, 'Import not found')
    throw new HttpError(409, batch.status === 'committing' ? 'This import is already being saved' : `Import is already ${batch.status}`)
  }
  try {
    return await writeBatch(db, subjectId, batchId, email, now)
  } catch (err) {
    await db.prepare("UPDATE import_batches SET status = 'open', committed_at = NULL WHERE id = ? AND status = 'committing'").bind(batchId).run()
    throw err
  }
}

async function writeBatch(db: D1Database, subjectId: string, batchId: string, email: string, now: string): Promise<CommitOutcome> {
  const candidates = (await db.prepare('SELECT id, file_id, status, document FROM extraction_candidates WHERE batch_id = ?').bind(batchId).all<CandidateRow>()).results
  if (candidates.some((c) => c.status === 'queued' || c.status === 'processing')) throw new HttpError(409, 'Some files are still being read')
  const ready = candidates
    .filter((c) => c.status === 'ready')
    .flatMap((candidate) => {
      const doc = parseJson<ExtractionDocument | null>(candidate.document, null)
      return doc ? [{ candidate, doc }] : []
    })
  if (!ready.length) throw new HttpError(400, 'Nothing to commit')

  // Only draws on the dates this import touches can receive its results, so only those are loaded.
  const dates = ready.flatMap(({ doc }) => doc.panels.map((p) => p.draw_date)).filter(isValidDate).sort()
  const from = dates[0] ?? ''
  const to = dates.at(-1) ?? ''
  const [markerRows, aliasRows, panelRows, resultRows, prefRows] = await db.batch([
    db.prepare('SELECT id, slug FROM lab_markers'),
    db.prepare("SELECT normalized_name, scope, marker_id FROM lab_marker_aliases WHERE scope IN ('global', ?)").bind(subjectId),
    db.prepare('SELECT id, draw_date, facility, tags FROM lab_panels WHERE subject_id = ? AND deleted_at IS NULL AND draw_date BETWEEN ? AND ?').bind(subjectId, from, to),
    db
      .prepare(
        `SELECT r.id, r.panel_id, r.marker_id, r.raw_value FROM lab_results r JOIN lab_panels p ON p.id = r.panel_id
         WHERE p.subject_id = ? AND p.deleted_at IS NULL AND p.draw_date BETWEEN ? AND ?`,
      )
      .bind(subjectId, from, to),
    db.prepare('SELECT hidden_marker_ids FROM preferences WHERE subject_id = ?').bind(subjectId),
  ])

  const statements: D1PreparedStatement[] = []
  const summary: CommitSummary = { panels_created: 0, panels_merged: 0, results_created: 0, results_replaced: 0, duplicates_skipped: 0, markers_created: 0, skipped: 0 }
  const conflicts: NonNullable<CommitSummary['same_day_conflicts']> = []
  let conflictCount = 0

  // Existing slugs (to keep new custom slugs unique) and markers by id.
  const idBySlug = new Map((markerRows.results as { id: string; slug: string }[]).map((m) => [m.slug, m.id]))
  const slugs = new Set(idBySlug.keys())
  const markerIds = new Set(idBySlug.values())
  const createdByName = new Map<string, string>()
  const subjectAlias = new Map<string, string>()
  const globalAlias = new Map<string, string>()
  for (const a of aliasRows.results as { normalized_name: string; scope: string; marker_id: string }[]) {
    ;(a.scope === 'global' ? globalAlias : subjectAlias).set(a.normalized_name, a.marker_id)
  }

  type PanelRef = { id: string; facility: string | null; tags: string[] }
  const panelsByDate = new Map<string, PanelRef[]>()
  for (const p of panelRows.results as { id: string; draw_date: string; facility: string | null; tags: string }[]) {
    const list = panelsByDate.get(p.draw_date) ?? []
    list.push({ id: p.id, facility: p.facility, tags: parseJson<string[]>(p.tags, []) })
    panelsByDate.set(p.draw_date, list)
  }
  const saved = new Map<string, { id: string; raw_value: string }>()
  for (const r of resultRows.results as { id: string; panel_id: string; marker_id: string; raw_value: string }[]) {
    saved.set(`${r.panel_id}|${r.marker_id}`, { id: r.id, raw_value: r.raw_value })
  }
  /** What this commit has already written for a draw and test, to catch a second value for the same pair. */
  const written = new Map<string, string>()
  const linkedFiles = new Set<string>()

  const committedMarkers = new Set<string>()
  const resolveMarker = (row: ExtractionDocument['panels'][number]['results'][number]): string => {
    if (row.marker_id && markerIds.has(row.marker_id) && row.match !== 'new') return row.marker_id
    const spec = row.new_marker ?? { name: row.raw_name, category: row.raw_test_category ?? 'uncategorized', default_units: row.raw_units ?? null }
    // A name with no letters or digits has no key; its own text stands in so it matches only itself.
    const key = normalizeAlias(spec.name) || spec.name.trim().toLowerCase()
    const already = createdByName.get(key)
    if (already) return already
    // "New" was true when the draft was reviewed. Another import, or an edit to the catalog, may have
    // created the test since; the database as it is now decides, so the same test is never made twice.
    const exists = subjectAlias.get(key) ?? globalAlias.get(key) ?? idBySlug.get(slugify(spec.name))
    if (exists && markerIds.has(exists)) {
      createdByName.set(key, exists)
      return exists
    }
    const id = newId('mk')
    // A name with no ASCII letters has no slug of its own; its id stands in, which no name can spell.
    const base = slugify(spec.name)
    let slug = base || `m-${id.slice(3)}`
    for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`
    slugs.add(slug)
    idBySlug.set(slug, id)
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

  for (const { candidate, doc } of ready) {
    for (const panel of doc.panels) {
      const included = panel.results.filter((r) => r.include !== false)
      summary.skipped += panel.results.length - included.length
      const tagsOnly = !included.length && Boolean(panel.tags?.length) && Boolean(panel.draw_date)
      if (!included.length && !tagsOnly) continue
      if (!isValidDate(panel.draw_date)) throw new HttpError(400, 'Every draw needs a real collection date before committing')
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
              `INSERT INTO lab_panels (id, subject_id, draw_date, draw_time, facility, ordering_provider, accession_number, panel_name, tags, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              target.id, subjectId, panel.draw_date, panel.draw_time ?? null, facility, panel.ordering_provider ?? null,
              panel.accession_number ?? null, panel.panel_name ?? null, JSON.stringify(panel.tags ?? []), now, now,
            ),
        )
      }
      // Every upload that put results on a draw stays linked to it as a source report.
      if (candidate.file_id && included.length && !linkedFiles.has(`${target.id}|${candidate.file_id}`)) {
        linkedFiles.add(`${target.id}|${candidate.file_id}`)
        statements.push(db.prepare('INSERT OR IGNORE INTO panel_files (panel_id, file_id) VALUES (?, ?)').bind(target.id, candidate.file_id))
      }
      for (const row of included) {
        const markerId = resolveMarker(row)
        committedMarkers.add(markerId)
        const key = `${target.id}|${markerId}`
        const first = written.get(key)
        if (first !== undefined) {
          if (sameReportedValue(first, row.raw_value)) summary.duplicates_skipped++
          else {
            conflictCount++
            if (conflicts.length < MAX_REPORTED_CONFLICTS) conflicts.push({ date: panel.draw_date, name: row.raw_name.trim(), kept: first, dropped: row.raw_value.trim() })
          }
          continue
        }
        // Remember how this report spells the test. A name the person matched by hand overrides what was known.
        const norm = normalizeAlias(row.raw_name)
        const known = subjectAlias.get(norm) ?? globalAlias.get(norm)
        if (norm && known !== markerId && (known === undefined || row.match === 'manual')) {
          subjectAlias.set(norm, markerId)
          statements.push(
            db
              .prepare(
                `INSERT INTO lab_marker_aliases (id, marker_id, source_name, normalized_name, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (normalized_name, scope) DO UPDATE SET marker_id = excluded.marker_id, source_name = excluded.source_name`,
              )
              .bind(newId('al'), markerId, row.raw_name.trim(), norm, subjectId, now),
          )
        }
        const derived = deriveResultFields(row.raw_value, row.reference_text, row.lab_flag)
        const values = [
          row.raw_name.trim(), row.raw_value.trim(), derived.comparator, derived.value_numeric, derived.value_text, row.raw_units?.trim() || null,
          derived.reference_text, derived.ref_low, derived.ref_high, derived.lab_flag, derived.flag_source,
          row.source_excerpt ?? null, row.source_row_id ?? null,
        ]
        const prior = saved.get(key)
        written.set(key, row.raw_value)
        if (prior && sameReportedValue(prior.raw_value, row.raw_value)) {
          summary.duplicates_skipped++
          continue
        }
        if (prior) {
          statements.push(
            db
              .prepare(
                `INSERT INTO result_revisions (id, result_id, action, before_json, after_json, changed_at, changed_by)
                 SELECT ?, id, 'import_replace', ${RESULT_JSON}, ?, ?, ? FROM lab_results WHERE id = ?`,
              )
              .bind(newId('rv'), JSON.stringify({ raw_value: row.raw_value, candidate_id: candidate.id }), now, email, prior.id),
            db
              .prepare(
                `UPDATE lab_results SET raw_name = ?, raw_value = ?, comparator = ?, value_numeric = ?, value_text = ?, raw_units = ?, reference_text = ?,
                   ref_low = ?, ref_high = ?, lab_flag = ?, flag_source = ?, source_excerpt = ?, source_row_id = ?, updated_at = ? WHERE id = ?`,
              )
              .bind(...values, now, prior.id),
          )
          summary.results_replaced++
        } else {
          statements.push(
            db
              .prepare(
                `INSERT INTO lab_results (raw_name, raw_value, comparator, value_numeric, value_text, raw_units, reference_text, ref_low, ref_high,
                   lab_flag, flag_source, source_excerpt, source_row_id, id, panel_id, subject_id, marker_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(...values, newId('rs'), target.id, subjectId, markerId, now, now),
          )
          summary.results_created++
        }
      }
    }
    // The draft held a second copy of every result; once they are saved it is not needed.
    statements.push(db.prepare("UPDATE extraction_candidates SET status = 'committed', document = NULL, updated_at = ? WHERE id = ?").bind(now, candidate.id))
  }
  // Files that could not be read, or were left out, go with the import.
  const dropped = candidates.filter((c) => c.status !== 'ready')
  for (const c of dropped) statements.push(db.prepare('DELETE FROM extraction_candidates WHERE id = ?').bind(c.id))

  // A removed marker that the user ticked back in during review is wanted again.
  const hidden = parseJson<string[]>((prefRows.results[0] as { hidden_marker_ids?: string } | undefined)?.hidden_marker_ids, [])
  const stillHidden = hidden.filter((id) => !committedMarkers.has(id))
  if (stillHidden.length !== hidden.length) {
    statements.push(db.prepare('UPDATE preferences SET hidden_marker_ids = ?, updated_at = ? WHERE subject_id = ?').bind(JSON.stringify(stillHidden), now, subjectId))
  }
  if (conflictCount) summary.same_day_conflict_count = conflictCount
  // The stored record holds counts only. The values that were not saved go back in the reply and nowhere else.
  statements.push(
    db
      .prepare("UPDATE import_batches SET status = 'committed', committed_at = ?, committed_by = ?, summary = ? WHERE id = ? AND status = 'committing'")
      .bind(now, email, JSON.stringify(summary), batchId),
  )
  await db.batch(statements)

  const linked = new Set([...linkedFiles].map((pair) => pair.split('|')[1]))
  const unusedFileIds = candidates.map((c) => c.file_id).filter((id): id is string => Boolean(id) && !linked.has(id!))
  return { summary: conflicts.length ? { ...summary, same_day_conflicts: conflicts } : summary, unusedFileIds }
}
