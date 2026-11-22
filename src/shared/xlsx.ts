// Minimal XLSX reader: enough to pull cell values (with date detection) from
// every worksheet. Avoids a heavyweight spreadsheet dependency in the Worker.
import { strFromU8, unzipSync } from 'fflate'

export type Cell = string | number | boolean | { date: string } | null
export type Sheet = { name: string; rows: Cell[][] }

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = unzipSync(bytes)
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : '')
  const shared = parseSharedStrings(text('xl/sharedStrings.xml'))
  const dateStyles = parseDateStyles(text('xl/styles.xml'))
  const rels = new Map<string, string>()
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''))
  }
  const sheets: Sheet[] = []
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(attr(m[0], 'name') ?? 'Sheet')
    const rid = attr(m[0], 'r:id')
    const target = rid ? rels.get(rid) : null
    if (!target) continue
    const xml = text(`xl/${target}`)
    if (!xml) continue
    sheets.push({ name, rows: parseSheet(xml, shared, dateStyles) })
  }
  return sheets
}

function parseSheet(xml: string, shared: string[], dateStyles: Set<number>): Cell[][] {
  const rows: Cell[][] = []
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(attr(rowMatch[1], 'r') ?? rows.length + 1) - 1
    const row: Cell[] = []
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const body = c[2] ?? ''
      const ref = attr(attrs, 'r')
      const col = ref ? columnIndex(ref) : row.length
      const type = attr(attrs, 't')
      const style = Number(attr(attrs, 's') ?? 0)
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value: Cell = null
      if (type === 's' && raw != null) value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') value = decodeXml(stripTags(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? ''))
      else if (type === 'str') value = raw != null ? decodeXml(raw) : ''
      else if (type === 'b') value = raw === '1'
      else if (raw != null) {
        const num = Number(raw)
        // Round binary float noise (13.300000000000001) to what a spreadsheet displays.
        value = dateStyles.has(style) && Number.isFinite(num) ? { date: serialToIso(num) } : Number(num.toPrecision(12))
      }
      row[col] = value
    }
    rows[rowIndex] = Array.from(row, (v) => v ?? null)
  }
  return Array.from(rows, (r) => r ?? [])
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // Concatenate rich-text runs; ignore phonetic runs.
    const body = si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    const parts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1])
    out.push(decodeXml(parts.join('')))
  }
  return out
}

function parseDateStyles(xml: string): Set<number> {
  const custom = new Map<number, string>()
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId'))
    const code = decodeXml(attr(m[0], 'formatCode') ?? '')
    custom.set(id, code)
  }
  const styles = new Set<number>()
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  let index = 0
  for (const xf of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
    const fmt = Number(attr(xf[0], 'numFmtId') ?? 0)
    if (BUILTIN_DATE_FORMATS.has(fmt) || isDateFormat(custom.get(fmt))) styles.add(index)
    index++
  }
  return styles
}

function isDateFormat(code: string | undefined): boolean {
  if (!code) return false
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
  return /[dmy]/i.test(stripped) && !/^[#0.,%\s]+$/.test(stripped)
}

function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000)
  return new Date(ms).toISOString().slice(0, 16)
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`))
  return m ? m[1] : null
}

function stripTags(value: string): string {
  return [...value.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}
