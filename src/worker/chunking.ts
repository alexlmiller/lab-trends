// Long PDFs are read a few pages at a time. The model's reply has a fixed
// token budget (roughly 200 results), so one pass over a full-history export
// would be cut off; each chunk stays well under it and the panels from all
// chunks are merged back by collection date.
import { normalizeAlias } from '../shared/markers'
import { sameReportedValue } from '../shared/semantics'
import type { ExtractedPanel, ExtractedResult } from '../shared/types'

/**
 * Text per model call, counted without layout padding. A compact table row is
 * about 55 characters and a portal-style result about 120, so this is 40–90
 * results: half the reply budget at most.
 */
export const CHUNK_CHARS = 5_000
export const PAGE_BREAK = '\n\n--- page break ---\n\n'

export type Chunk = { text: string; pages: [number, number] }

/** Size that matters for the model: column-alignment spaces collapse to one. */
export const denseLength = (text: string) => text.replace(/\s+/g, ' ').trim().length

/** Pack whole pages into chunks under the budget; a page over it is split at blank lines. */
export function chunkPages(pages: string[], budget = CHUNK_CHARS): Chunk[] {
  const chunks: Chunk[] = []
  let parts: string[] = []
  let size = 0
  let first = 0
  let last = 0
  const flush = () => {
    if (parts.length) chunks.push({ text: parts.join(PAGE_BREAK), pages: [first, last] })
    parts = []
    size = 0
  }
  pages.forEach((page, i) => {
    for (const part of splitText(page, budget)) {
      const n = denseLength(part)
      if (!n) continue
      if (parts.length && size + n > budget) flush()
      if (!parts.length) first = i + 1
      parts.push(part)
      size += n
      last = i + 1
    }
  })
  flush()
  return chunks
}

/**
 * Split text into pieces under the budget at line breaks, preferring a blank
 * line in the second half of a piece so a test's name, value and range stay
 * together. A single line over the budget stays whole.
 */
export function splitText(text: string, budget: number): string[] {
  if (denseLength(text) <= budget) return [text]
  const out: string[] = []
  let buf: string[] = []
  let size = 0
  for (const line of text.split('\n')) {
    const n = denseLength(line) + 1
    if (buf.length && size + n > budget) {
      const blank = buf.findLastIndex((l, i) => i >= buf.length / 2 && !l.trim())
      const keep = blank > 0 ? buf.slice(0, blank) : buf
      const carry = blank > 0 ? buf.slice(blank + 1) : []
      out.push(keep.join('\n'))
      buf = carry
      size = carry.reduce((s, l) => s + denseLength(l) + 1, 0)
    }
    buf.push(line)
    size += n
  }
  if (buf.some((l) => l.trim())) out.push(buf.join('\n'))
  return out
}

const fits = (a: string | null | undefined, b: string | null | undefined) => !a?.trim() || !b?.trim() || a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * One panel per collection date: panels on the same date merge unless their
 * facility, accession number or time disagree. Rows repeated across chunks
 * (same test name and value) are kept once.
 */
export function mergePanels(panels: ExtractedPanel[]): ExtractedPanel[] {
  const out: ExtractedPanel[] = []
  for (const p of panels) {
    const into = p.draw_date
      ? out.find((q) => q.draw_date === p.draw_date && fits(q.facility, p.facility) && fits(q.accession_number, p.accession_number) && fits(q.draw_time, p.draw_time))
      : undefined
    if (!into) {
      out.push({ ...p, results: dedupeResults(p.results), warnings: [...new Set(p.warnings ?? [])] })
      continue
    }
    into.panel_name ||= p.panel_name
    into.collected_at ||= p.collected_at
    into.draw_time ||= p.draw_time
    into.facility ||= p.facility
    into.ordering_provider ||= p.ordering_provider
    into.accession_number ||= p.accession_number
    into.results = dedupeResults([...into.results, ...p.results])
    into.warnings = [...new Set([...(into.warnings ?? []), ...(p.warnings ?? [])])]
  }
  return out
}

function dedupeResults(rows: ExtractedResult[]): ExtractedResult[] {
  const seen = new Map<string, string[]>()
  return rows.filter((r) => {
    const key = normalizeAlias(r.raw_name)
    const values = seen.get(key) ?? []
    if (values.some((v) => sameReportedValue(v, r.raw_value))) return false
    seen.set(key, [...values, r.raw_value])
    return true
  })
}

/** Run fn over items with at most `limit` in flight, keeping input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
