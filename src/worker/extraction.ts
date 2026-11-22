// Turns an uploaded file into an ExtractionDocument (a reviewable proposal).
// Tabular files are parsed deterministically; PDFs and images go through a
// model on Cloudflare's AI binding. Nothing here writes committed records.
import { normalizeCategory } from '../shared/categories'
import { parseLooseDate } from '../shared/dates'
import { extractTextItems } from 'unpdf'
import { layoutPage } from '../shared/pdfLayout'
import { normalizeFlag, normalizeReferenceText } from '../shared/semantics'
import { parseCsv, sheetsToDocument } from '../shared/tabular'
import type { ExtractedPanel, ExtractionDocument, SourceKind } from '../shared/types'
import { readXlsx } from '../shared/xlsx'
import { chunkPages, denseLength, mapLimit, mergePanels, splitText, type Chunk } from './chunking'
import { isTransient, logMessage, settings } from './lib'
import { redact } from './redact'

export const PROMPT_VERSION = 'lab_extraction.v2'

export type ExtractionOutput = {
  document: ExtractionDocument
  model: string | null
  privacyMode: 'local' | 'cloudflare_ai' | 'cloudflare_ai_redacted' | 'third_party_redacted' | 'third_party'
}

export function extractTabular(bytes: ArrayBuffer, kind: 'csv' | 'xlsx', filename: string): ExtractionOutput {
  const sheets =
    kind === 'xlsx'
      ? readXlsx(new Uint8Array(bytes))
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
/** About 100 pages: what fits in the queue consumer's 15-minute run. */
const MAX_CHUNKS = 40
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

export async function extractWithModel(
  env: Env,
  kind: Extract<SourceKind, 'pdf' | 'image'>,
  bytes: ArrayBuffer,
  filename: string,
  mime: string,
): Promise<ExtractionOutput> {
  const models = modelsFor(env)
  const model = kind === 'image' ? models.photo : models.pdf
  const firstParty = isCloudflareModel(model)
  if (kind === 'image') {
    const read = await readOnce(env, model, [
      { type: 'text', text: `${preamble(filename)}\n\nExtract the lab results shown in this image.` },
      { type: 'image_url', image_url: { url: `data:${mime || 'image/png'};base64,${toBase64(bytes)}` } },
    ])
    return { document: finishDocument(kind, read.panels, read.warnings), model, privacyMode: firstParty ? 'cloudflare_ai' : 'third_party' }
  }

  const pages = (await pdfPages(env, bytes, filename)).map((page) => redact(page).text)
  if (denseLength(pages.join(' ')) < 40) throw new Error('This PDF has no text layer (it may be a scan). Upload a photo or screenshot of the report instead.')
  const read = await readPages(env, model, filename, pages)
  return {
    document: finishDocument(kind, read.panels, read.warnings),
    model,
    privacyMode: firstParty ? 'cloudflare_ai_redacted' : 'third_party_redacted',
  }
}

/** Read page texts in chunks, a few at a time; a chunk that fails outright becomes a warning. */
export async function readPages(env: Env, model: string, filename: string, pages: string[]): Promise<Read> {
  const all = chunkPages(pages)
  const chunks = all.slice(0, MAX_CHUNKS)
  const warnings: string[] = []
  if (all.length > chunks.length) {
    warnings.push(`This PDF is very long, so only pages 1–${chunks.at(-1)!.pages[1]} of ${pages.length} were read. Upload the remaining pages as a separate PDF.`)
  }
  // Later chunks see the top of page 1 for the collection date and facility, which many reports print only once.
  const header = chunks.length > 1 ? headerOf(pages.find((p) => p.trim()) ?? '') : ''
  const failures: unknown[] = []
  const reads = await mapLimit(chunks, PARALLEL_CHUNKS, async (chunk, i) => {
    try {
      return await readText(env, model, filename, chunk, pages.length, { header: i > 0 ? header : '', partial: chunks.length > 1 }, 0)
    } catch (err) {
      // Retry the whole file for capacity errors; otherwise keep what the other chunks found.
      if (chunks.length === 1 || isTransient(err)) throw err
      console.error('extraction chunk failed', chunk.pages.join('-'), logMessage(err))
      failures.push(err)
      return { panels: [], warnings: [`${pageLabel(chunk.pages)} could not be read, so results there are missing. Check them against the report.`] }
    }
  })
  if (failures.length === chunks.length) throw failures[0]
  return { panels: reads.flatMap((r) => r.panels), warnings: [...warnings, ...reads.flatMap((r) => r.warnings)] }
}

async function readText(
  env: Env,
  model: string,
  filename: string,
  chunk: Chunk,
  totalPages: number,
  context: { header: string; partial: boolean },
  depth: number,
): Promise<Read> {
  const lines = [preamble(filename)]
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
      pieces.map((text, i) => readText(env, model, filename, { text, pages: chunk.pages }, totalPages, { header: i > 0 ? context.header || headerOf(chunk.text) : context.header, partial: true }, depth + 1)),
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

const preamble = (filename: string) => `Prompt version: ${PROMPT_VERSION}\nSource file: ${filename}\n\nExtraction rules:\n${RULES}`
const fence = (text: string) => '```\n' + text + '\n```'
const headerOf = (text: string) => text.split('\n').slice(0, 40).join('\n').slice(0, 2_000)
const pageLabel = ([a, b]: [number, number]) => (a === b ? `Page ${a}` : `Pages ${a}–${b}`)

export const DEFAULT_MODEL = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'

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
  if (model.includes('deepseek')) {
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
async function pdfPages(env: Env, bytes: ArrayBuffer, filename: string): Promise<string[]> {
  try {
    const { items } = await extractTextItems(new Uint8Array(bytes.slice(0)))
    const pages = items.map((page) => layoutPage(page.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, fontSize: i.fontSize }))))
    if (denseLength(pages.join(' ')) >= 40) return pages
  } catch (err) {
    console.error('pdf.js text extraction failed', logMessage(err))
  }
  const converted = await env.AI.toMarkdown({ name: filename, blob: new Blob([bytes], { type: 'application/pdf' }) })
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

function toBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < arr.length; i += 0x8000) binary += String.fromCharCode(...arr.subarray(i, i + 0x8000))
  return btoa(binary)
}
