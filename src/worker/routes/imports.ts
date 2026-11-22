// Imports: uploads waiting to be read, drafts under review, saving them, and
// the uploaded files themselves. An import that is discarded, or a file left
// out of one, is deleted: the draft, its row and the stored upload.
import { Hono } from 'hono'
import type { ExtractionDocument } from '../../shared/types'
import { forgetCatalog } from '../catalog'
import { commitBatch } from '../commit'
import { cleanDocument, failCandidate, failStuck, readTabular } from '../imports'
import { contentTypeFor, HttpError, jsonBody, newId, nowIso, parseJson, servedType, sha256Hex, sourceKindFor, type AppEnv } from '../lib'
import { annotateDocument } from '../resolve'
import { deleteFiles, deleteImport } from '../storage'

export const imports = new Hono<AppEnv>()

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_FILES = 20
/** Everything in one upload is held in memory while it is stored, so the whole request is bounded too. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024

imports.post('/subjects/:sid/imports', async (c) => {
  const sid = c.get('sid')
  const form = await boundedForm(c.req.raw)
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string')
  if (!files.length) throw new HttpError(400, 'Choose at least one file')
  if (files.length > MAX_FILES) throw new HttpError(400, `Add at most ${MAX_FILES} files at a time`)
  const uploads = files.map((file) => {
    const kind = sourceKindFor(file.name, file.type)
    if (!kind) throw new HttpError(400, `${file.name.slice(0, 80)}: unsupported file type. Use PDF, an image, CSV or XLSX.`)
    if (file.size > MAX_FILE_BYTES) throw new HttpError(400, `${file.name.slice(0, 80)} is larger than 20 MB`)
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
    const candidateId = newId('cd')
    const filename = file.name.trim().slice(0, 200) || 'upload'
    // The end of the name is kept, so the extension survives the cut.
    const key = `${sid}/${fileId}/${filename.replace(/[^\w.\- ]+/g, '_').slice(-120)}`
    const type = contentTypeFor(filename, kind)
    // The file's rows first: bytes without a row could never be found again to delete.
    const [, inserted] = await db.batch([
      db.prepare('INSERT INTO files (id, subject_id, r2_key, filename, mime_type, byte_size, sha256, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(fileId, sid, key, filename, type, file.size, sha, now, email),
      // "duplicate:<date>" in the error column notes an earlier upload of the same bytes; it is shown as a warning once the file is read.
      db.prepare(
        `INSERT INTO extraction_candidates (id, batch_id, subject_id, file_id, source_kind, status, error, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'queued',
           (SELECT 'duplicate:' || substr(MIN(created_at), 1, 10) FROM files WHERE subject_id = ?3 AND sha256 = ?6 AND id != ?4), ?7, ?7) RETURNING error`,
      ).bind(candidateId, batchId, sid, fileId, kind, sha, now),
    ])
    const uploadedBefore = (inserted.results[0] as { error: string | null } | undefined)?.error?.slice(10) ?? null
    try {
      await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type } })
    } catch {
      await failCandidate(db, candidateId, new HttpError(500, 'The file could not be stored. Upload it again.'))
      continue
    }
    if (kind === 'csv' || kind === 'xlsx') await readTabular(c.env, candidateId, sid, bytes, kind, filename, uploadedBefore)
    else await c.env.EXTRACTIONS.send({ candidateId })
  }
  return c.json(await loadBatch(db, sid, batchId, false), 201)
})

imports.post('/subjects/:sid/imports/manual', async (c) => {
  const db = c.env.DB
  const batchId = newId('ib')
  const now = nowIso()
  const doc: ExtractionDocument = { source_kind: 'manual', panels: [{ draw_date: null, results: [], tags: [] }], document_warnings: [] }
  await db.batch([
    db.prepare("INSERT INTO import_batches (id, subject_id, status, created_at, created_by) VALUES (?, ?, 'open', ?, ?)").bind(batchId, c.get('sid'), now, c.get('actor')),
    db.prepare(
      "INSERT INTO extraction_candidates (id, batch_id, subject_id, source_kind, status, document, privacy_mode, created_at, updated_at) VALUES (?, ?, ?, 'manual', 'ready', ?, 'local', ?, ?)",
    ).bind(newId('cd'), batchId, c.get('sid'), JSON.stringify(doc), now, now),
  ])
  return c.json({ id: batchId }, 201)
})

imports.get('/subjects/:sid/imports', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.status, b.created_at, b.created_by, b.committed_at, b.summary,
       (SELECT json_group_array(json_object('id', x.id, 'status', x.status, 'filename', f.filename, 'source_kind', x.source_kind))
        FROM extraction_candidates x LEFT JOIN files f ON f.id = x.file_id WHERE x.batch_id = b.id) AS candidates_json
     FROM import_batches b WHERE b.subject_id = ? ORDER BY b.created_at DESC LIMIT 50`,
  )
    .bind(c.get('sid'))
    .all<Record<string, unknown>>()
  return c.json(rows.results.map((b) => ({ ...b, candidates_json: undefined, summary: parseJson(b.summary, null), candidates: parseJson(b.candidates_json, []) })))
})

/** `?brief=1` leaves the drafts out: enough to ask whether reading has finished. */
imports.get('/subjects/:sid/imports/:bid', async (c) => c.json(await loadBatch(c.env.DB, c.get('sid'), c.req.param('bid'), c.req.query('brief') !== '1')))

imports.put('/subjects/:sid/imports/:bid/candidates/:cid', async (c) => {
  const sid = c.get('sid')
  const document = cleanDocument((await jsonBody(c)).document)
  const row = await c.env.DB.prepare('SELECT status FROM extraction_candidates WHERE id = ? AND batch_id = ? AND subject_id = ?')
    .bind(c.req.param('cid'), c.req.param('bid'), sid)
    .first<{ status: string }>()
  if (!row) throw new HttpError(404, 'File not found in this import')
  if (row.status !== 'ready') throw new HttpError(409, `Cannot edit a ${row.status} file`)
  const annotated = await annotateDocument(c.env.DB, sid, document)
  await c.env.DB.prepare("UPDATE extraction_candidates SET document = ?, updated_at = ? WHERE id = ? AND status = 'ready'").bind(JSON.stringify(annotated), nowIso(), c.req.param('cid')).run()
  return c.json({ document: annotated })
})

imports.post('/subjects/:sid/imports/:bid/candidates/:cid/retry', async (c) => {
  const sid = c.get('sid')
  const db = c.env.DB
  const row = await db
    .prepare(
      `SELECT x.source_kind, f.r2_key, f.filename FROM extraction_candidates x LEFT JOIN files f ON f.id = x.file_id
       WHERE x.id = ? AND x.batch_id = ? AND x.subject_id = ? AND x.status = 'failed'`,
    )
    .bind(c.req.param('cid'), c.req.param('bid'), sid)
    .first<{ source_kind: string; r2_key: string | null; filename: string | null }>()
  if (!row) throw new HttpError(409, 'Only failed files can be retried')
  const tabular = row.source_kind === 'csv' || row.source_kind === 'xlsx'
  if (!tabular && !c.env.EXTRACTIONS) throw new HttpError(422, 'This deployment has no extraction queue.')
  const claimed = await db.prepare("UPDATE extraction_candidates SET status = 'queued', error = NULL, attempts = 0, updated_at = ? WHERE id = ? AND status = 'failed'").bind(nowIso(), c.req.param('cid')).run()
  if (!claimed.meta.changes) throw new HttpError(409, 'Only failed files can be retried')
  if (tabular) {
    const obj = row.r2_key ? await c.env.FILES.get(row.r2_key) : null
    if (!obj) await failCandidate(db, c.req.param('cid'), new HttpError(404, 'The uploaded file is missing. Upload it again.'))
    else await readTabular(c.env, c.req.param('cid'), sid, await obj.arrayBuffer(), row.source_kind as 'csv' | 'xlsx', row.filename ?? 'upload', null)
  } else await c.env.EXTRACTIONS.send({ candidateId: c.req.param('cid') })
  return c.json({ ok: true })
})

/** Leave one file out of an import: its draft and its upload are deleted. An import left with no files goes too. */
imports.delete('/subjects/:sid/imports/:bid/candidates/:cid', async (c) => {
  const sid = c.get('sid')
  const bid = c.req.param('bid')
  const row = await c.env.DB.prepare(
    'SELECT x.status, b.status AS batch_status FROM extraction_candidates x JOIN import_batches b ON b.id = x.batch_id WHERE x.id = ? AND x.batch_id = ? AND x.subject_id = ?',
  )
    .bind(c.req.param('cid'), bid, sid)
    .first<{ status: string; batch_status: string }>()
  if (!row) throw new HttpError(404, 'File not found in this import')
  if (row.batch_status !== 'open') throw new HttpError(409, `Import is already ${row.batch_status}`)
  if (row.status !== 'ready' && row.status !== 'failed') throw new HttpError(409, 'This file is still being read')
  await deleteImport(c.env, sid, bid, c.req.param('cid'))
  const emptied = await c.env.DB.prepare("DELETE FROM import_batches WHERE id = ? AND status = 'open' AND NOT EXISTS (SELECT 1 FROM extraction_candidates WHERE batch_id = ?)").bind(bid, bid).run()
  return c.json({ ok: true, import_deleted: emptied.meta.changes > 0 })
})

imports.post('/subjects/:sid/imports/:bid/commit', async (c) => {
  const { summary, unusedFileIds } = await commitBatch(c.env.DB, c.get('sid'), c.req.param('bid'), c.get('actor'))
  if (summary.markers_created) forgetCatalog()
  await deleteFiles(c.env, unusedFileIds)
  return c.json(summary)
})

/** Discard an import that was not saved: every draft and every upload in it is deleted. */
imports.post('/subjects/:sid/imports/:bid/discard', async (c) => {
  const sid = c.get('sid')
  const bid = c.req.param('bid')
  const batch = await c.env.DB.prepare('SELECT status FROM import_batches WHERE id = ? AND subject_id = ?').bind(bid, sid).first<{ status: string }>()
  if (!batch) throw new HttpError(404, 'Import not found')
  if (batch.status !== 'open') throw new HttpError(409, `Import is already ${batch.status}`)
  await deleteImport(c.env, sid, bid)
  return c.json({ ok: true })
})

imports.get('/subjects/:sid/files/:fid', async (c) => {
  const file = await c.env.DB.prepare('SELECT r2_key, filename, mime_type FROM files WHERE id = ? AND subject_id = ?').bind(c.req.param('fid'), c.get('sid')).first<{ r2_key: string; filename: string; mime_type: string | null }>()
  if (!file) throw new HttpError(404, 'File not found')
  const obj = await c.env.FILES.get(file.r2_key)
  if (!obj) throw new HttpError(404, 'File bytes not found')
  return new Response(obj.body, {
    headers: {
      'Content-Type': servedType(file.filename, file.mime_type),
      'Content-Disposition': `inline; filename="${file.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // The upload is shown as a document and nothing more: no scripts, no requests, no access to this app.
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  })
})

/**
 * The upload form, read only if it is within the size one request may hold.
 * A declared length over the limit is refused before a byte is read; without
 * a declared length the bytes are counted as they arrive.
 */
async function boundedForm(request: Request): Promise<FormData> {
  const tooLarge = () => new HttpError(413, 'These files are more than 64 MB together. Add them in smaller groups.')
  const declared = Number(request.headers.get('Content-Length') ?? NaN)
  if (declared > MAX_UPLOAD_BYTES) throw tooLarge()
  if (Number.isFinite(declared) || !request.body) return request.formData()
  const reader = request.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_UPLOAD_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value as Uint8Array<ArrayBuffer>)
  }
  return new Response(new Blob(chunks), { headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' } }).formData()
}

async function loadBatch(db: D1Database, sid: string, batchId: string, withDocuments: boolean) {
  const [, batches, candidates] = await db.batch([
    failStuck(db, batchId),
    db.prepare('SELECT id, status, created_at, created_by, committed_at, summary FROM import_batches WHERE id = ? AND subject_id = ?').bind(batchId, sid),
    db.prepare(
      `SELECT x.id, x.batch_id, x.file_id, x.source_kind, x.status, x.model, x.privacy_mode, x.error, x.created_at, x.updated_at,
         ${withDocuments ? 'x.document' : 'NULL AS document'}, f.filename, f.mime_type
       FROM extraction_candidates x LEFT JOIN files f ON f.id = x.file_id WHERE x.batch_id = ? AND x.subject_id = ? ORDER BY x.created_at`,
    ).bind(batchId, sid),
  ])
  const batch = batches.results[0] as Record<string, unknown> | undefined
  if (!batch) throw new HttpError(404, 'Import not found')
  return {
    ...batch,
    summary: parseJson(batch.summary, null),
    candidates: (candidates.results as Record<string, unknown>[]).map((x) => ({
      ...x,
      filename: x.filename ?? null,
      mime_type: x.mime_type ?? null,
      document: parseJson(x.document, null),
      // An earlier-upload note is not an error; it is only shown as one if reading the file failed.
      error: typeof x.error === 'string' && x.error.startsWith('duplicate:') ? null : x.error,
    })),
  }
}
