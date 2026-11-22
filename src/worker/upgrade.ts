// One-time repairs to stored data after a release changes how it is derived.
// A result's number, range and inferred flag are computed when it is saved, and
// an alias holds a normalized name, so a fix to those rules has to be applied
// to the rows already stored. The repair runs a small step on each request
// after a deploy, records its place in app_state, and is safe to run twice.
import { isValidDate } from '../shared/dates'
import { normalizeAlias } from '../shared/markers'
import { deriveResultFields } from '../shared/semantics'
import type { ExtractionDocument } from '../shared/types'
import { logMessage, newId, nowIso, parseJson } from './lib'
import { deleteFiles, deletePanelStatements } from './storage'

/**
 * Raise this when a rule that stored rows depend on changes:
 *  2 - range, value and flag parsing; alias keys keep "%", "#" and non-Latin letters;
 *      every source file is linked to its draw; deleted records are removed for good.
 */
export const DATA_VERSION = 2

type State = { version: number; step?: number; cursor?: string }
/** One bounded piece of work. Returns where to resume, or null when the step is finished. */
type Step = (env: Env, cursor: string) => Promise<string | null>

const STEPS: Step[] = [rederiveResults, addAliasKeys, linkSourceFiles, removeDeleted]

let upToDate = false

/** For tests, which use more than one database in a process. */
export function forgetUpgrade() {
  upToDate = false
}

/** Run the next piece of any pending repair. Cheap once done: a flag in memory, then nothing. */
export async function upgradeData(env: Env): Promise<void> {
  if (upToDate) return
  try {
    const row = await env.DB.prepare("SELECT value FROM app_state WHERE key = 'data'").first<{ value: string }>()
    const state = parseJson<State>(row?.value, { version: 1 })
    if (state.version >= DATA_VERSION) {
      upToDate = true
      return
    }
    let step = state.step ?? 0
    let cursor = (await STEPS[step](env, state.cursor ?? '')) ?? ''
    if (!cursor) step++
    const next: State = step >= STEPS.length ? { version: DATA_VERSION } : { version: state.version, step, cursor }
    await env.DB.prepare("INSERT INTO app_state (key, value) VALUES ('data', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(next)).run()
    upToDate = next.version >= DATA_VERSION
  } catch (err) {
    // A repair must never take the app down; the next request tries again.
    console.error('data upgrade step failed', logMessage(err))
  }
}

type StoredResult = {
  id: string
  raw_value: string
  reference_text: string | null
  lab_flag: string | null
  flag_source: string | null
  comparator: string | null
  value_numeric: number | null
  value_text: string | null
  ref_low: number | null
  ref_high: number | null
}

/** Recompute each result's derived columns from the text it was saved with. A flag the lab reported is kept. */
async function rederiveResults(env: Env, cursor: string): Promise<string | null> {
  const rows = (
    await env.DB
      .prepare('SELECT id, raw_value, reference_text, lab_flag, flag_source, comparator, value_numeric, value_text, ref_low, ref_high FROM lab_results WHERE id > ? ORDER BY id LIMIT 400')
      .bind(cursor)
      .all<StoredResult>()
  ).results
  const updates: D1PreparedStatement[] = []
  for (const r of rows) {
    const d = deriveResultFields(r.raw_value, r.reference_text, r.flag_source === 'reported' ? r.lab_flag : null)
    // A reported flag whose word the new rules no longer recognise stays as the lab's flag.
    const flag = r.flag_source === 'reported' && !d.lab_flag ? { lab_flag: r.lab_flag, flag_source: 'reported' } : { lab_flag: d.lab_flag, flag_source: d.flag_source }
    const same =
      d.comparator === r.comparator && d.value_numeric === r.value_numeric && d.value_text === r.value_text && d.reference_text === r.reference_text &&
      d.ref_low === r.ref_low && d.ref_high === r.ref_high && flag.lab_flag === r.lab_flag && flag.flag_source === r.flag_source
    if (same) continue
    updates.push(
      env.DB
        .prepare('UPDATE lab_results SET comparator = ?, value_numeric = ?, value_text = ?, reference_text = ?, ref_low = ?, ref_high = ?, lab_flag = ?, flag_source = ? WHERE id = ?')
        .bind(d.comparator, d.value_numeric, d.value_text, d.reference_text, d.ref_low, d.ref_high, flag.lab_flag, flag.flag_source, r.id),
    )
  }
  if (updates.length) await env.DB.batch(updates)
  return rows.length === 400 ? rows[rows.length - 1].id : null
}

/** Give every stored spelling the key the current rules produce. The key it had stays, as the bare name's default. */
async function addAliasKeys(env: Env, cursor: string): Promise<string | null> {
  const rows = (
    await env.DB.prepare('SELECT id, marker_id, source_name, normalized_name, scope FROM lab_marker_aliases WHERE id > ? ORDER BY id LIMIT 400').bind(cursor).all<{
      id: string
      marker_id: string
      source_name: string
      normalized_name: string
      scope: string
    }>()
  ).results
  const now = nowIso()
  const inserts = rows
    .map((a) => ({ a, key: normalizeAlias(a.source_name) }))
    .filter(({ a, key }) => key && key !== a.normalized_name)
    .map(({ a, key }) =>
      env.DB
        .prepare('INSERT OR IGNORE INTO lab_marker_aliases (id, marker_id, source_name, normalized_name, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(newId('al'), a.marker_id, a.source_name, key, a.scope, now),
    )
  if (inserts.length) await env.DB.batch(inserts)
  return rows.length === 400 ? rows[rows.length - 1].id : null
}

/**
 * Imports saved before draws listed all their sources kept only the first
 * file on a draw. Link the others from the drafts those imports left behind,
 * then drop the drafts: each is a second copy of results that are now saved.
 */
async function linkSourceFiles(env: Env): Promise<string | null> {
  const rows = (
    await env.DB
      .prepare("SELECT id, subject_id, file_id, document FROM extraction_candidates WHERE status = 'committed' AND document IS NOT NULL LIMIT 20")
      .all<{ id: string; subject_id: string; file_id: string | null; document: string }>()
  ).results
  const statements: D1PreparedStatement[] = []
  for (const c of rows) {
    const doc = parseJson<ExtractionDocument | null>(c.document, null)
    const dates = [...new Set((doc?.panels ?? []).filter((p) => p.results.some((r) => r.include !== false)).map((p) => p.draw_date).filter(isValidDate))]
    if (c.file_id) {
      for (const date of dates) {
        statements.push(
          env.DB
            .prepare('INSERT OR IGNORE INTO panel_files (panel_id, file_id) SELECT id, ? FROM lab_panels WHERE subject_id = ? AND draw_date = ? AND deleted_at IS NULL')
            .bind(c.file_id, c.subject_id, date),
        )
      }
    }
    statements.push(env.DB.prepare('UPDATE extraction_candidates SET document = NULL WHERE id = ?').bind(c.id))
  }
  if (statements.length) await env.DB.batch(statements)
  // Every row handled leaves the query, so "more to do" is simply "the page was full".
  return rows.length === 20 ? 'more' : null
}

/**
 * Deleting used to hide a record and keep it. Remove what people already
 * deleted: draws marked deleted, imports that were discarded with their
 * uploads, and the copies kept of deleted results.
 */
async function removeDeleted(env: Env): Promise<string | null> {
  const db = env.DB
  const panels = (await db.prepare('SELECT id, subject_id FROM lab_panels WHERE deleted_at IS NOT NULL LIMIT 20').all<{ id: string; subject_id: string }>()).results
  if (panels.length) {
    await db.batch(panels.flatMap((p) => deletePanelStatements(db, p.subject_id, [p.id])))
    return 'more'
  }
  const discarded = (
    await db
      .prepare(
        `SELECT x.id, x.file_id FROM extraction_candidates x JOIN import_batches b ON b.id = x.batch_id
         WHERE x.status IN ('discarded', 'failed') AND b.status != 'open' LIMIT 40`,
      )
      .all<{ id: string; file_id: string | null }>()
  ).results
  if (discarded.length) {
    await db.batch(discarded.map((x) => db.prepare('DELETE FROM extraction_candidates WHERE id = ?').bind(x.id)))
    // Only an upload nothing else uses: the same file is never shared, but a draw may still link to it.
    const fileIds = discarded.map((x) => x.file_id).filter((id): id is string => Boolean(id))
    const unlinked: string[] = []
    for (const id of fileIds) {
      if (!(await db.prepare('SELECT 1 FROM panel_files WHERE file_id = ? LIMIT 1').bind(id).first())) unlinked.push(id)
    }
    await deleteFiles(env, unlinked)
    return 'more'
  }
  await db.batch([
    db.prepare("DELETE FROM import_batches WHERE status = 'discarded' AND id NOT IN (SELECT batch_id FROM extraction_candidates)"),
    db.prepare('DELETE FROM result_revisions WHERE result_id NOT IN (SELECT id FROM lab_results)'),
  ])
  return null
}
