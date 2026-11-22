// Turns an uploaded file into an ExtractionDocument (a reviewable proposal).
// Tabular files are parsed deterministically; PDFs and images go through a
// model on Cloudflare's AI binding. Nothing here writes committed records.
import { normalizeCategory } from '../shared/categories'
import { parseLooseDate } from '../shared/dates'
import { extractTextItems } from 'unpdf'
import { layoutPage } from '../shared/pdfLayout'
import { DECIMAL_COMMA_NOTE, normalizeFlag, normalizeReferenceText, usesDecimalComma } from '../shared/semantics'
import { parseCsv, sheetsToDocument } from '../shared/tabular'
import type { ExtractedPanel, ExtractionDocument, SourceKind } from '../shared/types'
import { readXlsx } from '../shared/xlsx'
import { chunkPages, denseLength, mapLimit, mergePanels, splitText, type Chunk } from './chunking'
import { isAccountRefusal, isTransient, logMessage, settings } from './lib'
import { redact } from './redact'

export const PROMPT_VERSION = 'lab_extraction.v2'

export type ExtractionOutput = {
  document: ExtractionDocument
  model: string | null
  privacyMode: 'local' | 'cloudflare_ai' | 'cloudflare_ai_redacted' | 'third_party_redacted' | 'third_party'
}

export async function extractTabular(bytes: ArrayBuffer, kind: 'csv' | 'xlsx', filename: string): Promise<ExtractionOutput> {
  const sheets =
    kind === 'xlsx'
      ? await readXlsx(new Uint8Array(bytes))
      : [{ name: filename.replace(/\.[^.]+$/, ''), rows: parseCsv(new TextDecoder().decode(bytes)) }]
  return { document: sheetsToDocument(sheets, kind), model: null, privacyMode: 'local' }
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    raw_name: { type: 'string', description: 'Test name exactly as printed' },
    raw_test_category: { type: ['string', 'null'], description: 'Panel/section the test is listed under' },
    raw_value: { type: 'string', description: 'Result exactly as printed, including < or > if shown' },
    raw_units: { type: ['string', 'null'] },
    reference_text: { type: ['string', 'null'], description: 'Reference range exactly as printed' },
    lab_flag: { type: ['string', 'null'], enum: ['low', 'high', 'critical', 'abnormal', null] },
    confidence: { type: 'number' },
    source_excerpt: { type: ['string', 'null'], description: 'Short quote of the line supporting this result' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['raw_name', 'raw_value'],
}

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    panels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          panel_name: { type: ['string', 'null'] },
          collected_at: { type: ['string', 'null'], description: 'Specimen collection date/time as YYYY-MM-DD or YYYY-MM-DDTHH:MM, as printed (no timezone conversion)' },
          facility: { type: ['string', 'null'] },
          ordering_provider: { type: ['string', 'null'] },
          accession_number: { type: ['string', 'null'] },
          results: { type: 'array', items: RESULT_SCHEMA },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['results'],
      },
    },
    document_warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['panels'],
}

const SYSTEM = [
  'You extract clinical laboratory results from lab reports. Return JSON only.',
  'Preserve lab facts exactly as displayed. Do not infer missing values, units, reference ranges, dates, flags or providers.',
  'If uncertain, use null or add a warning instead of guessing.',
  'Identifiers may be replaced with [REDACTED_*] placeholders; do not try to identify the patient.',
].join(' ')

const RULES = [
  '- Each reported measured test becomes one result. Skip headers, comments and interpretive text.',
  '- Keep raw_name, raw_value, raw_units and reference_text as close to the printed text as possible.',
  '- Keep comparators that are part of the value in raw_value (e.g. "<0.5").',
  '- lab_flag only when an abnormal flag is explicitly shown next to the result (H, L, HH, LL, *, "High", "Low", "Abnormal"); otherwise null.',
  '- collected_at is the specimen collection date (not the report or print date). Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.',
  '- If the document contains several collection dates or panels, return one panel per collection date/panel. Each result belongs to the panel of its own collection date.',
  '- confidence is 0-1 for how sure you are that the row was read correctly.',
  '- warnings and document_warnings are only for problems a person must check against the report, such as a value or date you could not read or a result you could not place under a date. Do not restate these rules, mention the page-1 context, or note that no flags are printed.',
  '- Patient-portal reports (e.g. MyChart) print "Normal range: …" under each test name, the result value on its own line below, and the range endpoints again under a slider graphic. The result is the lone value between the range line and the slider endpoints.',
].join('\n')

/** Chunks read at once; more only trips Workers AI rate limits. */
const PARALLEL_CHUNKS = 4
/** About 100 pages. Each part is a model call, so this also caps what one file can cost. */
const MAX_CHUNKS = 40
/**
 * A queue consumer is stopped after 15 minutes, and a read that is stopped starts again
 * from nothing. So no new part of a report is started after `startMs`, and a part still
 * being read at `waitMs` is given up. A slow model then ends a long report early, with a
 * warning naming the pages, and what it did read is kept.
 */
const READ_BUDGET = { startMs: 9 * 60_000, waitMs: 13 * 60_000 }
/** A chunk whose reply is cut off is split again, at most this many times. */
const MAX_SPLITS = 3

type Messages = { role: string; content: unknown }[]
type Read = { panels: ExtractedPanel[]; warnings: string[] }

/** The model's reply ran out of tokens before the JSON closed. */
class Overflow extends Error {
  constructor() {
    super('This part of the report has more results than the model can return at once.')
  }
}

/** The file's name never goes to the model: people name reports after the patient. */
export async function extractWithModel(env: Env, kind: Extract<SourceKind, 'pdf' | 'image'>, bytes: ArrayBuffer, mime: string): Promise<ExtractionOutput> {
  const models = modelsFor(env)
  const model = kind === 'image' ? models.photo : models.pdf
  const firstParty = isCloudflareModel(model)
  if (kind === 'image') {
    const read = await readOnce(env, model, [
      { type: 'text', text: `${PREAMBLE}\n\nExtract the lab results shown in this image.` },
      { type: 'image_url', image_url: { url: `data:${mime || 'image/png'};base64,${toBase64(bytes)}` } },
    ])
    return { document: finishDocument(kind, read.panels, read.warnings), model, privacyMode: firstParty ? 'cloudflare_ai' : 'third_party' }
  }

  const pages = (await pdfPages(env, bytes)).map(redact)
  if (denseLength(pages.join(' ')) < 40) throw new Error('This PDF has no text layer (it may be a scan). Upload a photo or screenshot of the report instead.')
  const read = await readPages(env, model, pages)
  return {
    document: finishDocument(kind, read.panels, read.warnings),
    model,
    privacyMode: firstParty ? 'cloudflare_ai_redacted' : 'third_party_redacted',
  }
}

/** Read page texts in chunks, a few at a time; a chunk that fails outright becomes a warning. */
export async function readPages(env: Env, model: string, pages: string[], budget = READ_BUDGET): Promise<Read> {
  const all = chunkPages(pages)
  const chunks = all.slice(0, MAX_CHUNKS)
  const warnings: string[] = []
  if (all.length > chunks.length) {
    warnings.push(`This PDF is very long, so only pages 1–${chunks.at(-1)!.pages[1]} of ${pages.length} were read. Upload the remaining pages as a separate PDF.`)
  }
  // Later chunks see the top of page 1 for the collection date and facility, which many reports print only once.
  const header = chunks.length > 1 ? headerOf(pages.find((p) => p.trim()) ?? '') : ''
  const failures: unknown[] = []
  const unread: Chunk[] = []
  const began = Date.now()
  const reads = await mapLimit(chunks, PARALLEL_CHUNKS, async (chunk, i): Promise<Read> => {
    if (i > 0 && Date.now() - began > budget.startMs) {
      unread.push(chunk)
      return { panels: [], warnings: [] }
    }
    try {
      const read = await within(readText(env, model, chunk, pages.length, { header: i > 0 ? header : '', partial: chunks.length > 1 }, 0), began + budget.waitMs - Date.now())
      if (read) return read
      unread.push(chunk)
      return { panels: [], warnings: [] }
    } catch (err) {
      // Retry the whole file for capacity errors, and stop it when the account cannot run the model at all:
      // half a report read before the day's allowance ran out must not pass for the whole report.
      // Otherwise keep what the other chunks found.
      if (chunks.length === 1 || isTransient(err) || isAccountRefusal(err)) throw err
      console.error('extraction chunk failed', chunk.pages.join('-'), logMessage(err))
      failures.push(err)
      return { panels: [], warnings: [`${pageLabel(chunk.pages)} could not be read, so results there are missing. Check them against the report.`] }
    }
  })
  if (failures.length === chunks.length) throw failures[0]
  if (unread.length + failures.length === chunks.length) throw new Error('The model took too long to read this file. Choose Try again, or upload fewer pages at a time.')
  if (unread.length) {
    warnings.push(`This PDF took too long to read in one go. Not read: ${pageRanges(unread)}. Upload them as a separate PDF.`)
  }
  return { panels: reads.flatMap((r) => r.panels), warnings: [...warnings, ...reads.flatMap((r) => r.warnings)] }
}

/** The promise's value, or null when it takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms))
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/** "pages 61–99", or "pages 13–18, 40–99" when the parts are not next to each other. */
function pageRanges(chunks: Chunk[]): string {
  const ranges: [number, number][] = []
  for (const [from, to] of chunks.map((c) => c.pages).sort((a, b) => a[0] - b[0])) {
    const last = ranges.at(-1)
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else ranges.push([from, to])
  }
  const only = ranges.length === 1 && ranges[0][0] === ranges[0][1]
  return `${only ? 'page' : 'pages'} ${ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')}`
}

async function readText(env: Env, model: string, chunk: Chunk, totalPages: number, context: { header: string; partial: boolean }, depth: number): Promise<Read> {
  const lines = [PREAMBLE]
  if (context.header) {
    lines.push(
      '',
      'Top of page 1, for the collection date, facility and accession number only. Use it when the report text below does not show its own; do not extract results from it:',
      fence(context.header),
    )
  }
  const where = totalPages > 1 ? ` (${pageLabel(chunk.pages).toLowerCase()} of ${totalPages})` : ''
  lines.push('', `Report text${where}:${context.partial ? ' this is one part of a longer report; extract only the results shown in it.' : ''}`, fence(chunk.text))
  try {
    return await readOnce(env, model, [{ type: 'text', text: lines.join('\n') }])
  } catch (err) {
    if (!(err instanceof Overflow) || depth >= MAX_SPLITS) throw err
    const pieces = splitText(chunk.text, Math.ceil(denseLength(chunk.text) / 2))
    if (pieces.length < 2) throw err
    const parts = await Promise.all(
      pieces.map((text, i) => readText(env, model, { text, pages: chunk.pages }, totalPages, { header: i > 0 ? context.header || headerOf(chunk.text) : context.header, partial: true }, depth + 1)),
    )
    return { panels: parts.flatMap((p) => p.panels), warnings: parts.flatMap((p) => p.warnings) }
  }
}

async function readOnce(env: Env, model: string, user: unknown[]): Promise<Read> {
  const messages: Messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
  let raw = await callModel(env, model, messages)
  if (cutOff(raw)) throw new Overflow()
  let parsed: unknown
  try {
    parsed = parseModelJson(raw)
  } catch (err) {
    if (looksCutOff(raw)) throw new Overflow()
    // One schema-repair attempt, then give up.
    const previous = modelText(raw).slice(0, 60_000)
    raw = await callModel(env, model, [
      ...messages,
      { role: 'assistant', content: previous },
      { role: 'user', content: `That response could not be parsed (${err instanceof Error ? err.message : 'invalid JSON'}). Return only the corrected JSON object matching the schema, with no commentary.` },
    ])
    if (cutOff(raw)) throw new Overflow()
    parsed = parseModelJson(raw)
  }
  return readPanels(parsed)
}

const PREAMBLE = `Prompt version: ${PROMPT_VERSION}\n\nExtraction rules:\n${RULES}`
const fence = (text: string) => '```\n' + text + '\n```'
const headerOf = (text: string) => text.split('\n').slice(0, 40).join('\n').slice(0, 2_000)
const pageLabel = ([a, b]: [number, number]) => (a === b ? `Page ${a}` : `Pages ${a}–${b}`)

/** Offered on the Workers Free plan, and reads photos as well as text. */
export const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it'

/** The model that reads each kind of upload: the EXTRACTION_MODEL / VISION_MODEL settings, or the default. */
export function modelsFor(env: Env): { pdf: string; photo: string } {
  const s = settings(env)
  const pdf = s.EXTRACTION_MODEL || DEFAULT_MODEL
  return { pdf, photo: s.VISION_MODEL || pdf }
}

/** Workers AI models (@cf/…) run on Cloudflare; any other id is routed to that provider. */
export function isCloudflareModel(model: string): boolean {
  return model.startsWith('@cf/')
}

/** Model call with two quick retries for capacity and rate-limit errors. */
async function callModel(env: Env, model: string, messages: Messages): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runModel(env, model, messages)
    } catch (err) {
      if (attempt >= 2 || !isTransient(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, 4_000 * (attempt + 1) ** 2))
    }
  }
}

/** Model-specific request shape: reasoning off, deterministic, schema-constrained JSON. */
async function runModel(env: Env, model: string, messages: Messages): Promise<unknown> {
  const input: Record<string, unknown> = {
    messages,
    response_format: { type: 'json_schema', json_schema: { name: 'lab_extraction', schema: EXTRACTION_SCHEMA } },
    temperature: 0,
  }
  if (model.includes('gemma-4')) {
    // Thinking is on unless asked off, and would spend the reply's tokens before the JSON starts.
    input.chat_template_kwargs = { enable_thinking: false }
    input.max_completion_tokens = 16_384
  } else if (model.includes('deepseek')) {
    input.reasoning_effort = 'none'
    input.max_completion_tokens = 16_384
  } else {
    input.max_tokens = 16_384
  }
  if (model.includes('kimi')) input.chat_template_kwargs = { thinking: false }
  const gateway = settings(env).AI_GATEWAY_ID
  const options = gateway ? { gateway: { id: gateway } } : undefined
  return (env.AI.run as (m: string, i: unknown, o?: unknown) => Promise<unknown>)(model, input, options)
}

function cutOff(raw: unknown): boolean {
  const r = raw as { finish_reason?: string; choices?: { finish_reason?: string }[] }
  return (r?.choices?.[0]?.finish_reason ?? r?.finish_reason) === 'length'
}

/** Unparseable and unterminated: the reply stopped mid-JSON, which a repair prompt can't fix. */
function looksCutOff(raw: unknown): boolean {
  const text = modelText(raw).trim().replace(/\s*```$/, '')
  return text.length > 2_000 && !text.endsWith('}')
}

function modelText(raw: unknown): string {
  const r = raw as { response?: unknown; choices?: { message?: { content?: unknown } }[] }
  const v = r?.response ?? r?.choices?.[0]?.message?.content ?? raw
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** Layout-preserving text per page via pdf.js; falls back to Workers AI markdown conversion. */
async function pdfPages(env: Env, bytes: ArrayBuffer): Promise<string[]> {
  try {
    const { items } = await extractTextItems(new Uint8Array(bytes.slice(0)))
    const pages = items.map((page) => layoutPage(page.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, fontSize: i.fontSize }))))
    if (denseLength(pages.join(' ')) >= 40) return pages
  } catch (err) {
    console.error('pdf.js text extraction failed', logMessage(err))
  }
  const converted = await env.AI.toMarkdown({ name: 'report.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) })
  const result = Array.isArray(converted) ? converted[0] : converted
  if (!result || result.format === 'error') throw new Error(`Could not read PDF text: ${(result as { error?: string })?.error ?? 'conversion failed'}`)
  return [String(result.data ?? '')]
}

function parseModelJson(raw: unknown): unknown {
  const pick = (value: unknown): unknown => {
    if (value && typeof value === 'object') return value
    if (typeof value !== 'string') return null
    const stripped = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
      return JSON.parse(stripped)
    } catch {
      const start = stripped.indexOf('{')
      const end = stripped.lastIndexOf('}')
      if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1))
      throw new Error('Model response was not valid JSON')
    }
  }
  const r = raw as { response?: unknown; choices?: { message?: { content?: unknown } }[]; result?: unknown }
  const candidate = r?.response ?? r?.choices?.[0]?.message?.content ?? r?.result ?? raw
  const value = pick(candidate)
  if (!value || typeof value !== 'object') throw new Error('Model returned no extraction')
  return value
}

function readPanels(value: unknown): Read {
  const v = value as { panels?: unknown[]; document_warnings?: unknown[] }
  const panels: ExtractedPanel[] = []
  for (const p of (Array.isArray(v.panels) ? v.panels : []) as Record<string, unknown>[]) {
    const when = parseLooseDate(str(p.collected_at))
    const results = (Array.isArray(p.results) ? p.results : []) as Record<string, unknown>[]
    panels.push({
      panel_name: str(p.panel_name),
      collected_at: str(p.collected_at),
      draw_date: when?.date ?? null,
      draw_time: when?.time ?? null,
      facility: str(p.facility),
      ordering_provider: str(p.ordering_provider),
      accession_number: str(p.accession_number),
      tags: [],
      warnings: strings(p.warnings),
      results: results
        .filter((r) => str(r.raw_name) && str(r.raw_value))
        .map((r) => ({
          raw_name: str(r.raw_name)!,
          raw_test_category: r.raw_test_category ? normalizeCategory(str(r.raw_test_category)) : (p.panel_name ? normalizeCategory(str(p.panel_name)) : null),
          raw_value: str(r.raw_value)!,
          raw_units: str(r.raw_units),
          reference_text: normalizeReferenceText(str(r.reference_text)),
          lab_flag: normalizeFlag(str(r.lab_flag)),
          confidence: typeof r.confidence === 'number' ? r.confidence : null,
          source_excerpt: str(r.source_excerpt),
          warnings: strings(r.warnings),
        })),
    })
  }
  return { panels, warnings: strings(v.document_warnings) }
}

export function finishDocument(kind: SourceKind, panels: ExtractedPanel[], warnings: string[]): ExtractionDocument {
  const merged = mergePanels(panels).filter((p) => p.results.length)
  const notes = [...new Set(warnings)]
  if (!merged.length) notes.push('No lab results were found in this file.')
  // A long report is read in pieces, and a piece can lose sight of the date its results belong to.
  if (new Set(merged.map((p) => p.draw_date).filter(Boolean)).size > 1) notes.push('This report has results from more than one collection date. Check that each result is under the right date.')
  if (merged.some((p) => p.results.some((r) => usesDecimalComma(r.raw_value)))) notes.push(DECIMAL_COMMA_NOTE)
  for (const p of merged) if (!p.draw_date) p.warnings = [...(p.warnings ?? []), 'Collection date not found. Set it before committing.']
  return { source_kind: kind, panels: merged, document_warnings: notes }
}

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s && s.toLowerCase() !== 'null' ? s : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((x) => String(x)).filter(Boolean) : []
}

/**
 * Base64 by the runtime's own encoder where there is one. Building the string in
 * JavaScript costs about 25 ms of CPU per megabyte, and the Workers Free plan
 * allows 10 ms for a whole invocation.
 */
export function toBase64(bytes: ArrayBuffer): string {
  const native = (globalThis as { Buffer?: { from(data: ArrayBuffer): { toString(encoding: 'base64'): string } } }).Buffer
  if (native) return native.from(bytes).toString('base64')
  const arr = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < arr.length; i += 0x8000) binary += String.fromCharCode(...arr.subarray(i, i + 0x8000))
  return btoa(binary)
}
