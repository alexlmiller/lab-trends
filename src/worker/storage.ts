// Deleting for good. An uploaded report lives in R2 with a row in `files`, and
// it is kept exactly as long as something a person can see points at it: a
// draw it put results on, or an import still being reviewed. Everything here
// removes the stored bytes first and the rows that named them second, so a
// failure can leave a row without its file but never a file nobody can find.

/** D1 allows 100 bound values in a statement. */
const CHUNK = 50

function* chunks<T>(items: T[], size = CHUNK): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size)
}

const marks = (items: unknown[]) => items.map(() => '?').join(', ')

/** Delete uploads: the stored bytes, then their rows. Imports that listed them keep their line without the file. */
export async function deleteFiles(env: Env, fileIds: string[]): Promise<void> {
  for (const ids of chunks([...new Set(fileIds)])) {
    const rows = (await env.DB.prepare(`SELECT r2_key FROM files WHERE id IN (${marks(ids)})`).bind(...ids).all<{ r2_key: string }>()).results
    if (rows.length) await env.FILES.delete(rows.map((r) => r.r2_key))
    await env.DB.batch([
      env.DB.prepare(`UPDATE extraction_candidates SET file_id = NULL WHERE file_id IN (${marks(ids)})`).bind(...ids),
      env.DB.prepare(`UPDATE lab_panels SET source_file_id = NULL WHERE source_file_id IN (${marks(ids)})`).bind(...ids),
      env.DB.prepare(`DELETE FROM panel_files WHERE file_id IN (${marks(ids)})`).bind(...ids),
      env.DB.prepare(`DELETE FROM files WHERE id IN (${marks(ids)})`).bind(...ids),
    ])
  }
}

/** Uploads of one person that no draw links to and no import under review still needs. */
export async function unlinkedFileIds(db: D1Database, subjectId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT f.id FROM files f WHERE f.subject_id = ?
         AND NOT EXISTS (SELECT 1 FROM panel_files pf WHERE pf.file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM extraction_candidates x JOIN import_batches b ON b.id = x.batch_id
                         WHERE x.file_id = f.id AND b.status IN ('open', 'committing'))`,
    )
    .bind(subjectId)
    .all<{ id: string }>()
  return rows.results.map((r) => r.id)
}

/** Statements that remove draws with their results, the old copies of those results, and their links to uploads. */
export function deletePanelStatements(db: D1Database, subjectId: string, panelIds: string[]): D1PreparedStatement[] {
  return [...chunks(panelIds)].flatMap((ids) => {
    const owned = `SELECT id FROM lab_panels WHERE subject_id = ? AND id IN (${marks(ids)})`
    return [
      db.prepare(`DELETE FROM result_revisions WHERE result_id IN (SELECT id FROM lab_results WHERE panel_id IN (${owned}))`).bind(subjectId, ...ids),
      db.prepare(`DELETE FROM lab_results WHERE panel_id IN (${owned})`).bind(subjectId, ...ids),
      db.prepare(`DELETE FROM panel_files WHERE panel_id IN (${owned})`).bind(subjectId, ...ids),
      db.prepare(`DELETE FROM lab_panels WHERE subject_id = ? AND id IN (${marks(ids)})`).bind(subjectId, ...ids),
    ]
  })
}

/** Delete draws, then any upload that only they were holding on to. */
export async function deletePanels(env: Env, subjectId: string, panelIds: string[]): Promise<void> {
  if (!panelIds.length) return
  await env.DB.batch(deletePanelStatements(env.DB, subjectId, panelIds))
  await deleteFiles(env, await unlinkedFileIds(env.DB, subjectId))
}

/** Delete an import that was never saved: its drafts and its uploads. */
export async function deleteImport(env: Env, subjectId: string, batchId: string, candidateId?: string): Promise<void> {
  const only = candidateId ? ' AND id = ?' : ''
  const bind = candidateId ? [batchId, subjectId, candidateId] : [batchId, subjectId]
  const rows = (await env.DB.prepare(`SELECT file_id FROM extraction_candidates WHERE batch_id = ? AND subject_id = ?${only}`).bind(...bind).all<{ file_id: string | null }>()).results
  const statements = [env.DB.prepare(`DELETE FROM extraction_candidates WHERE batch_id = ? AND subject_id = ?${only}`).bind(...bind)]
  if (!candidateId) statements.push(env.DB.prepare('DELETE FROM import_batches WHERE id = ? AND subject_id = ?').bind(batchId, subjectId))
  await env.DB.batch(statements)
  await deleteFiles(env, rows.map((r) => r.file_id).filter((id): id is string => Boolean(id)))
}

/** Delete a person and everything recorded about them: uploads, draws, results, imports, events, targets, views. */
export async function deleteSubject(env: Env, subjectId: string): Promise<void> {
  // Every upload is stored under the person's id, so this also removes bytes no row points at.
  let cursor: string | undefined
  do {
    const page = await env.FILES.list({ prefix: `${subjectId}/`, cursor })
    if (page.objects.length) await env.FILES.delete(page.objects.map((o) => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  const db = env.DB
  const mine = (table: string) => db.prepare(`DELETE FROM ${table} WHERE subject_id = ?`).bind(subjectId)
  await db.batch([
    db.prepare('DELETE FROM panel_files WHERE panel_id IN (SELECT id FROM lab_panels WHERE subject_id = ?)').bind(subjectId),
    mine('lab_results'),
    // Old copies of results are keyed by result alone; with the results gone, theirs go too.
    db.prepare('DELETE FROM result_revisions WHERE result_id NOT IN (SELECT id FROM lab_results)'),
    mine('lab_panels'),
    mine('extraction_candidates'),
    mine('import_batches'),
    mine('files'),
    mine('personal_targets'),
    mine('timeline_events'),
    mine('saved_views'),
    mine('preferences'),
    db.prepare('DELETE FROM lab_marker_aliases WHERE scope = ?').bind(subjectId),
    db.prepare('DELETE FROM subjects WHERE id = ?').bind(subjectId),
  ])
}
