// What happens to an upload between arriving and being reviewed: reading it,
// saving the draft, failing it clearly, and giving up on one that never finishes.
import type { ExtractedPanel, ExtractedResult, ExtractionDocument, SourceKind } from '../shared/types'
import { extractTabular, extractWithModel, PROMPT_VERSION } from './extraction'
import { HttpError, isPlanRefusal, isTransient, logMessage, nowIso, PLAN_REFUSAL_MESSAGE } from './lib'
import { annotateDocument } from './resolve'

/** A model read is tried this many times before the file is marked failed. */
const MAX_ATTEMPTS = 3
/** A draft is stored as one value, which D1 caps at 2 MB: about this many results. */
export const MAX_DRAFT_RESULTS = 5_000
/** After this long without progress a file is not being read any more: the Worker reading it was stopped. */
const STUCK_AFTER_MS = { tabular: 3 * 60_000, model: 20 * 60_000 }
const STUCK_MESSAGE = 'Reading this file did not finish. Choose Try again, or upload it again.'

export async function saveExtraction(env: Env, candidateId: string, sid: string, doc: ExtractionDocument, model: string | null, privacy: string) {
  const annotated = await annotateDocument(env.DB, sid, cleanDocument(doc))
  await env.DB.prepare(
    "UPDATE extraction_candidates SET status = 'ready', document = ?, model = ?, prompt_version = ?, privacy_mode = ?, error = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(JSON.stringify(annotated), model, model ? PROMPT_VERSION : null, privacy, nowIso(), candidateId)
    .run()
}

export async function failCandidate(db: D1Database, candidateId: string, err: unknown) {
  // Our own messages are written for people. Anything else may quote the report, so it is reduced first.
  const message = isPlanRefusal(err) ? PLAN_REFUSAL_MESSAGE : err instanceof HttpError ? err.message : logMessage(err)
  await db.prepare("UPDATE extraction_candidates SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(message.slice(0, 500), nowIso(), candidateId).run()
}

/** Read a spreadsheet or CSV upload right away; a failure is recorded on the file, never thrown. */
export async function readTabular(env: Env, candidateId: string, sid: string, bytes: ArrayBuffer, kind: 'csv' | 'xlsx', filename: string, uploadedBefore: string | null) {
  try {
    const out = await extractTabular(bytes, kind, filename)
    if (uploadedBefore) out.document.document_warnings.unshift(`This file was already uploaded on ${uploadedBefore}.`)
    await saveExtraction(env, candidateId, sid, out.document, null, 'local')
  } catch (err) {
    await failCandidate(env.DB, candidateId, err)
  }
}

/**
 * Mark files of an import failed when reading them stopped without a word: the
 * Worker ran out of time or memory, or the queue gave up. Without this they
 * would show "reading" for ever and the page would keep asking.
 */
export function failStuck(db: D1Database, batchId: string): D1PreparedStatement {
  const now = Date.now()
  return db
    .prepare(
      `UPDATE extraction_candidates SET status = 'failed', error = ?1, updated_at = ?2
       WHERE batch_id = ?3 AND status IN ('queued', 'processing')
         AND updated_at < CASE WHEN source_kind IN ('csv', 'xlsx') THEN ?4 ELSE ?5 END`,
    )
    .bind(STUCK_MESSAGE, nowIso(), batchId, new Date(now - STUCK_AFTER_MS.tabular).toISOString(), new Date(now - STUCK_AFTER_MS.model).toISOString())
}

/** Queue consumer: read one PDF or photo with the model. Returns 'retry' when the queue should deliver it again later. */
export async function processCandidate(env: Env, candidateId: string): Promise<'done' | 'retry'> {
  const db = env.DB
  // Claiming the file and counting the attempt is one statement, so a delivery that arrives twice does not read it twice.
  const row = await db
    .prepare(
      `UPDATE extraction_candidates SET status = 'processing', attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'processing') RETURNING subject_id, source_kind, error, attempts, file_id`,
    )
    .bind(nowIso(), candidateId)
    .first<{ subject_id: string; source_kind: string; error: string | null; attempts: number; file_id: string | null }>()
  if (!row) return 'done'
  try {
    // A file still "processing" after its attempts are used up was being read by a Worker that died each time.
    if (row.attempts > MAX_ATTEMPTS) throw new HttpError(500, STUCK_MESSAGE)
    const file = row.file_id ? await db.prepare('SELECT r2_key, filename, mime_type FROM files WHERE id = ?').bind(row.file_id).first<{ r2_key: string; filename: string; mime_type: string | null }>() : null
    const obj = file ? await env.FILES.get(file.r2_key) : null
    if (!file || !obj) throw new HttpError(404, 'The uploaded file is missing. Upload it again.')
    const out = await extractWithModel(env, row.source_kind as 'pdf' | 'image', await obj.arrayBuffer(), file.mime_type ?? '')
    const dup = row.error?.startsWith('duplicate:') ? row.error.slice(10) : null
    if (dup) out.document.document_warnings.unshift(`This file was already uploaded on ${dup}.`)
    await saveExtraction(env, candidateId, row.subject_id, out.document, out.model, out.privacyMode)
    return 'done'
  } catch (err) {
    console.error('extraction failed', candidateId, row.attempts, logMessage(err))
    if (isTransient(err) && row.attempts < MAX_ATTEMPTS) {
      await db.prepare("UPDATE extraction_candidates SET status = 'queued', updated_at = ? WHERE id = ?").bind(nowIso(), candidateId).run()
      return 'retry'
    }
    await failCandidate(db, candidateId, err)
    return 'done'
  }
}

// ─── Draft shape ────────────────────────────────────────────────────────

const cut = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)
const list = (value: unknown, max: number, each: number): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').slice(0, max).map((v) => v.trim().slice(0, each)) : []

/**
 * A draft rebuilt from only the fields a draft has, each with the type and
 * length it should have. Drafts come from a model, from an uploaded file and
 * back from the browser; none of them decides what is stored.
 */
export function cleanDocument(input: unknown): ExtractionDocument {
  const doc = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const kinds: SourceKind[] = ['pdf', 'image', 'csv', 'xlsx', 'manual']
  let total = 0
  const panels = (Array.isArray(doc.panels) ? doc.panels : []).slice(0, 500).map((p: Record<string, unknown>): ExtractedPanel => {
    const results = (Array.isArray(p?.results) ? p.results : []).flatMap((r: Record<string, unknown>): ExtractedResult[] => {
      const raw_name = cut(r?.raw_name, 200)
      const raw_value = cut(r?.raw_value, 200)
      if (!raw_name || !raw_value) return []
      const marker = (r.new_marker && typeof r.new_marker === 'object' ? r.new_marker : null) as Record<string, unknown> | null
      const name = cut(marker?.name, 120)
      // The saved result this row lined up with last time; review compares it to notice when that changes.
      const existing = (r.existing && typeof r.existing === 'object' ? r.existing : null) as Record<string, unknown> | null
      const existingId = cut(existing?.result_id, 60)
      return [
        {
          raw_name,
          raw_value,
          raw_test_category: cut(r.raw_test_category, 80),
          raw_units: cut(r.raw_units, 60),
          reference_text: cut(r.reference_text, 300),
          lab_flag: cut(r.lab_flag, 40),
          confidence: typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : null,
          source_excerpt: cut(r.source_excerpt, 300),
          source_row_id: cut(r.source_row_id, 120),
          warnings: list(r.warnings, 10, 300),
          marker_id: cut(r.marker_id, 60),
          match: (['slug', 'alias', 'manual', 'new'] as const).find((m) => m === r.match) ?? null,
          new_marker: name ? { name, category: cut(marker?.category, 60) ?? 'uncategorized', default_units: cut(marker?.default_units, 60) } : null,
          include: typeof r.include === 'boolean' ? r.include : undefined,
          existing: existingId ? { result_id: existingId, raw_value: cut(existing?.raw_value, 200) ?? '', raw_units: cut(existing?.raw_units, 60) } : null,
        },
      ]
    })
    total += results.length
    return {
      panel_name: cut(p?.panel_name, 200),
      collected_at: cut(p?.collected_at, 40),
      draw_date: cut(p?.draw_date, 10),
      draw_time: cut(p?.draw_time, 5),
      facility: cut(p?.facility, 200),
      ordering_provider: cut(p?.ordering_provider, 200),
      accession_number: cut(p?.accession_number, 80),
      tags: list(p?.tags, 50, 80),
      results,
      warnings: list(p?.warnings, 20, 300),
    }
  })
  if (total > MAX_DRAFT_RESULTS) throw new HttpError(413, `This file has ${total.toLocaleString('en-US')} results, more than the ${MAX_DRAFT_RESULTS.toLocaleString('en-US')} one import can hold. Split it into smaller files.`)
  return { source_kind: kinds.find((k) => k === doc.source_kind) ?? 'manual', panels, document_warnings: list(doc.document_warnings, 40, 400) }
}
