// Minimal XLSX reader: enough to pull cell values (with date and percent
// detection) from every worksheet, within fixed size limits. It reads only the
// parts of the archive a workbook needs.
import { listZip, readZipEntry, ZipError } from './zip'

export type Cell = string | number | boolean | { date: string } | null
export type Sheet = { name: string; rows: Cell[][]; /** Serial dates count from 1904, as old Mac workbooks do. */ date1904?: boolean }

/** Uncompressed bytes: one part of the workbook, and all parts read together. */
const MAX_PART = 12 * 1024 * 1024
const MAX_TOTAL = 24 * 1024 * 1024
const MAX_ROWS = 100_000
const MAX_COLUMNS = 2_000
const MAX_CELLS = 500_000
const TOO_LARGE = 'This spreadsheet is too large to read here. Save the sheet you need as a CSV file and upload that.'

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])
const BUILTIN_PERCENT_FORMATS = new Set([9, 10])

type Styles = { dates: Set<number>; percents: Set<number> }

export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  try {
    const entries = new Map(listZip(bytes).map((e) => [e.name, e]))
    let budget = MAX_TOTAL
    const text = async (path: string) => {
      const entry = entries.get(path)
      if (!entry) return ''
      const data = await readZipEntry(bytes, entry, Math.min(MAX_PART, budget))
      budget -= data.length
      return new TextDecoder().decode(data)
    }
    const workbook = await text('xl/workbook.xml')
    if (!workbook) throw new Error('This file is not an Excel workbook. Save it as .xlsx or .csv and upload it again.')
    const date1904 = /<workbookPr\b[^>]*\sdate1904="(?:1|true)"/.test(workbook)
    const shared = parseSharedStrings(await text('xl/sharedStrings.xml'))
    const styles = parseStyles(await text('xl/styles.xml'))
    const rels = new Map<string, string>()
    for (const m of (await text('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)) {
      const id = attr(m[0], ID)
      const target = attr(m[0], TARGET)
      if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''))
    }
    const sheets: Sheet[] = []
    const cells = { left: MAX_CELLS }
    for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
      const target = rels.get(attr(m[0], RID) ?? '')
      const xml = target ? await text(`xl/${target}`) : ''
      if (xml) sheets.push({ name: decodeXml(attr(m[0], NAME) ?? 'Sheet'), rows: parseSheet(xml, shared, styles, date1904, cells), date1904 })
    }
    return sheets
  } catch (err) {
    if (err instanceof ZipError) throw new Error(err.message === 'too large' ? TOO_LARGE : `${err.message} Save it as .xlsx or .csv and upload it again.`)
    throw err
  }
}

const R = /\sr="([^"]*)"/
const T = /\st="([^"]*)"/
const S = /\ss="([^"]*)"/
const ID = /\sId="([^"]*)"/
const TARGET = /\sTarget="([^"]*)"/
const RID = /\sr:id="([^"]*)"/
const NAME = /\sname="([^"]*)"/
const NUM_FMT_ID = /\snumFmtId="([^"]*)"/
const FORMAT_CODE = /\sformatCode="([^"]*)"/

const attr = (tag: string, pattern: RegExp): string | null => tag.match(pattern)?.[1] ?? null

function parseSheet(xml: string, shared: string[], styles: Styles, date1904: boolean, cells: { left: number }): Cell[][] {
  const rows: Cell[][] = []
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowIndex = Number(attr(rowMatch[1], R) ?? rows.length + 1) - 1
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= MAX_ROWS) throw new Error(TOO_LARGE)
    const row: Cell[] = []
    for (const c of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const body = c[2] ?? ''
      const ref = attr(attrs, R)
      const col = ref ? columnIndex(ref) : row.length
      if (col >= MAX_COLUMNS || --cells.left < 0) throw new Error(TOO_LARGE)
      const type = attr(attrs, T)
      const style = Number(attr(attrs, S) ?? 0)
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value: Cell = null
      if (type === 's' && raw != null) value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') value = decodeXml(textRuns(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? ''))
      else if (type === 'str') value = raw != null ? decodeXml(raw) : ''
      else if (type === 'b') value = raw === '1'
      // An error cell (#N/A, #DIV/0!) holds no value.
      else if (type !== 'e' && raw != null) value = numberCell(Number(raw), style, styles, date1904)
      row[col] = value
    }
    rows[rowIndex] = Array.from(row, (v) => v ?? null)
  }
  return Array.from(rows, (r) => r ?? [])
}

function numberCell(num: number, style: number, styles: Styles, date1904: boolean): Cell {
  if (!Number.isFinite(num)) return null
  // Only a serial inside the years a draw can have (1954 to 2119) is a date. A small number in a cell that
  // merely carries a date format stays the number it is.
  const serial = num + (date1904 ? 1462 : 0)
  if (styles.dates.has(style) && serial >= 20_000 && serial < 80_000) {
    return { date: new Date(Math.round((serial - 25569) * 86_400_000)).toISOString().slice(0, 16) }
  }
  // Round binary float noise (13.300000000000001) to what a spreadsheet displays.
  if (styles.percents.has(style)) return `${Number((num * 100).toPrecision(12))}%`
  return Number(num.toPrecision(12))
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  // Every <si> takes an index, including an empty <si/>.
  for (const si of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    // Concatenate rich-text runs; ignore phonetic runs.
    out.push(decodeXml(textRuns((si[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''))))
  }
  return out
}

/** The text of every <t> run, where an empty run may be written <t/>. */
function textRuns(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += m[1] ?? ''
  return out
}

function parseStyles(xml: string): Styles {
  const custom = new Map<number, string>()
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], NUM_FMT_ID)), decodeXml(attr(m[0], FORMAT_CODE) ?? ''))
  const styles: Styles = { dates: new Set(), percents: new Set() }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  let index = 0
  for (const xf of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
    const fmt = Number(attr(xf[0], NUM_FMT_ID) ?? 0)
    const code = formatBody(custom.get(fmt))
    if (BUILTIN_DATE_FORMATS.has(fmt) || (/[dmy]/i.test(code) && !/^[#0.,%\s]+$/.test(code))) styles.dates.add(index)
    else if (BUILTIN_PERCENT_FORMATS.has(fmt) || code.includes('%')) styles.percents.add(index)
    index++
  }
  return styles
}

/** A number format without its quoted text, colours and escaped characters. */
function formatBody(code: string | undefined): string {
  return (code ?? '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/** A numeric character reference, or nothing when the number is not a character. */
function codePoint(n: number): string {
  return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
}
