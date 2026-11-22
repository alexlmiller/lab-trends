// Deterministic CSV/XLSX → ExtractionDocument. Two layouts are recognised:
//  - row-oriented: one row per result with test/value/date columns
//  - pivoted history: Test | Reference Range | Units | <date> | <date> ...
//    (the layout of a hand-kept lab history spreadsheet; one tab per panel)
// Whatever is left out (a sheet, a column, a row) is named in a warning.
import { excelSerialToDate, parseLooseDate, slashDateOrder, type LooseDate } from './dates'
import { normalizeCategory } from './categories'
import { DECIMAL_COMMA_NOTE, normalizeFlag, normalizeReferenceText, parseLabValue, usesDecimalComma } from './semantics'
import type { ExtractedPanel, ExtractedResult, ExtractionDocument } from './types'
import type { Cell, Sheet } from './xlsx'

/** Comma, semicolon or tab, whichever the first line uses most. A quote opens a quoted field only at its start. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  const delimiter = sniffDelimiter(src)
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function sniffDelimiter(src: string): string {
  const line = src.slice(0, 4_000).split(/\r?\n/).find((l) => l.trim()) ?? ''
  const unquoted = line.replace(/"[^"]*"/g, '')
  const count = (ch: string) => unquoted.split(ch).length - 1
  return [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',')
}

/** How far down a sheet the header row may sit, under a title or an export note. */
const HEADER_SEARCH = 10

type PanelFor = (date: string, time: string | null, extra?: Partial<ExtractedPanel>) => ExtractedPanel
type Reader = { sheet: Sheet; rows: Cell[][]; header: number; panelFor: PanelFor; warnings: string[]; decimalCommas: { seen: boolean } }

export function sheetsToDocument(sheets: Sheet[], kind: 'csv' | 'xlsx'): ExtractionDocument {
  const byDate = new Map<string, ExtractedPanel>()
  const warnings: string[] = []
  const panelFor: PanelFor = (date, time, extra) => {
    const key = `${date}|${extra?.facility ?? ''}|${extra?.accession_number ?? ''}`
    let panel = byDate.get(key)
    if (!panel) {
      panel = { draw_date: date, draw_time: time, results: [], tags: [], warnings: [], ...extra }
      byDate.set(key, panel)
    }
    return panel
  }

  const skipped: string[] = []
  const decimalCommas = { seen: false }
  for (const sheet of sheets) {
    const rows = sheet.rows.filter((r) => r.some((c) => cellText(c) !== ''))
    if (!rows.length) continue
    const header = rows.slice(0, HEADER_SEARCH).findIndex((r) => isPivotHeader(r) || isRowHeader(r))
    if (header < 0) {
      skipped.push(sheet.name)
      continue
    }
    const reader: Reader = { sheet, rows, header, panelFor, warnings, decimalCommas }
    if (isPivotHeader(rows[header])) readPivot(reader)
    else readRows(reader)
  }
  if (skipped.length && sheets.length === 1) {
    warnings.push(`Could not recognise the columns in "${skipped[0]}". Expected test/value/date columns or a Test | Reference Range | Units | dates layout.`)
  } else if (skipped.length) {
    warnings.push(`Left out, because the columns were not recognised: ${skipped.map((s) => `"${s}"`).join(', ')}.`)
  }
  if (decimalCommas.seen) warnings.push(DECIMAL_COMMA_NOTE)
  const panels = [...byDate.values()].filter((p) => p.results.length).sort((a, b) => (a.draw_date ?? '').localeCompare(b.draw_date ?? ''))
  for (const p of panels) p.tags = [...new Set(p.tags)]
  return { source_kind: kind, panels, document_warnings: warnings }
}

function readPivot({ sheet, rows, header: at, panelFor, warnings, decimalCommas }: Reader) {
  const header = rows[at]
  const dayFirst = dateOrder(header.slice(3), sheet.name, warnings)
  const dateCols: { col: number; date: string }[] = []
  const notDates: string[] = []
  for (let col = 3; col < header.length; col++) {
    const d = cellDate(header[col], sheet, dayFirst)?.date
    if (d) dateCols.push({ col, date: d })
    else if (cellText(header[col])) notDates.push(cellText(header[col]))
  }
  if (!dateCols.length) warnings.push(`"${sheet.name}" looks like a pivoted history but no date columns were found.`)
  else if (notDates.length) warnings.push(`In "${sheet.name}", these columns were not read as dates and were left out: ${notDates.slice(0, 8).map((s) => `"${s}"`).join(', ')}${notDates.length > 8 ? ' and others' : ''}.`)
  const category = normalizeCategory(sheet.name)
  let dateRanges = 0
  for (let r = at + 1; r < rows.length; r++) {
    const row = rows[r]
    const name = cellText(row[0])
    if (!name) continue
    if (isDate(row[1])) dateRanges++
    const reference = isDate(row[1]) ? null : normalizeReferenceText(cellText(row[1]))
    const units = cellText(row[2]) || null
    if (/^cycle\s*day$/i.test(name) || /^(fasting|notes?|context)$/i.test(name)) {
      for (const { col, date } of dateCols) {
        const v = cellText(row[col])
        if (v) panelFor(date, null).tags!.push(/^cycle/i.test(name) ? `cycle ${v.replace(/^day\s*/i, 'day ')}`.toLowerCase() : `${name.toLowerCase()}: ${v}`)
      }
      continue
    }
    for (const { col, date } of dateCols) {
      const raw = cellText(row[col])
      if (!raw) continue
      if (usesDecimalComma(raw)) decimalCommas.seen = true
      panelFor(date, null).results.push({
        raw_name: name,
        raw_test_category: category,
        raw_value: raw,
        raw_units: units,
        reference_text: reference,
        lab_flag: parseLabValue(raw).flag ?? null,
        source_row_id: `${sheet.name}!R${r + 1}C${col + 1}`,
      })
    }
  }
  warnDateRanges(dateRanges, sheet.name, warnings)
}

// The first alias a sheet has wins, so "Test" is the test column even when a "Name" column comes before it.
const ALIASES = {
  name: ['test_name', 'test', 'analyte', 'analyte_name', 'component', 'component_name', 'test_description', 'marker', 'name'],
  value: ['raw_value', 'value', 'result', 'result_value', 'results'],
  date: ['drawn_at', 'collection_date', 'collected', 'date_collected', 'collected_at', 'collected_on', 'collected_date', 'date_of_collection', 'draw_date', 'sample_date', 'specimen_date', 'date', 'test_date', 'observation_date', 'result_date'],
  units: ['raw_units', 'units', 'unit', 'uom'],
  reference: ['reported_reference_range_text', 'reference_range', 'range', 'reference', 'ref_range', 'reference_interval', 'normal_range', 'standard_range'],
  flag: ['lab_flag', 'flag', 'abnormal'],
  category: ['category', 'panel', 'panel_name', 'panel_template_name'],
  facility: ['facility', 'lab', 'source_facility', 'performing_lab'],
  provider: ['ordering_provider', 'provider'],
  accession: ['accession_number', 'accession'],
  rowId: ['source_row_id', 'row_id', 'id'],
  notes: ['notes', 'note', 'comment'],
}
type Field = keyof typeof ALIASES

function readRows({ sheet, rows, header: at, panelFor, warnings, decimalCommas }: Reader) {
  const keys = rows[at].map((c) => normKey(cellText(c)))
  const column = (field: Field) => {
    for (const alias of ALIASES[field]) {
      const i = keys.indexOf(alias)
      if (i >= 0) return i
    }
    return -1
  }
  const col = Object.fromEntries((Object.keys(ALIASES) as Field[]).map((f) => [f, column(f)])) as Record<Field, number>
  const dayFirst = dateOrder(rows.slice(at + 1).map((row) => row[col.date]), sheet.name, warnings)
  let undated = 0
  let unnamed = 0
  let dateRanges = 0
  for (let r = at + 1; r < rows.length; r++) {
    const row = rows[r]
    const get = (c: number) => (c >= 0 ? cellText(row[c]) : '')
    const name = get(col.name)
    const raw = get(col.value)
    if (!raw) continue
    if (!name) {
      unnamed++
      continue
    }
    const when = cellDate(row[col.date], sheet, dayFirst)
    if (!when) {
      undated++
      continue
    }
    if (usesDecimalComma(raw)) decimalCommas.seen = true
    if (isDate(row[col.reference])) dateRanges++
    const result: ExtractedResult = {
      raw_name: name,
      raw_test_category: get(col.category) ? normalizeCategory(get(col.category)) : null,
      raw_value: raw,
      raw_units: get(col.units) || null,
      reference_text: isDate(row[col.reference]) ? null : normalizeReferenceText(get(col.reference)),
      lab_flag: normalizeFlag(get(col.flag)) ?? parseLabValue(raw).flag ?? null,
      source_row_id: get(col.rowId) || `${sheet.name}!R${r + 1}`,
    }
    const notes = get(col.notes)
    if (notes) result.warnings = [`note: ${notes}`]
    panelFor(when.date, when.time, {
      facility: get(col.facility) || null,
      ordering_provider: get(col.provider) || null,
      accession_number: get(col.accession) || null,
    }).results.push(result)
  }
  if (undated) warnings.push(`${undated} row(s) in "${sheet.name}" had no readable date and were skipped.`)
  if (unnamed) warnings.push(`${unnamed} row(s) in "${sheet.name}" had a value but no test name and were skipped. A merged name cell covers only its first row.`)
  warnDateRanges(dateRanges, sheet.name, warnings)
}

function warnDateRanges(count: number, sheetName: string, warnings: string[]) {
  if (count) warnings.push(`${count} reference range(s) in "${sheetName}" hold a date, not a range, and were left out. A spreadsheet turns a range such as 1-5 into a date.`)
}

/** Whether a set of date cells writes the day first, with a warning when their own numbers cannot tell. */
function dateOrder(cells: (Cell | undefined)[], sheetName: string, warnings: string[]): boolean {
  const order = slashDateOrder(cells.filter((c): c is string => typeof c === 'string'))
  if (order === 'mixed') warnings.push(`Dates in "${sheetName}" mix day/month and month/day order. They were read as month/day/year unless the first number is above 12, so check the draw dates.`)
  if (order === 'unclear') warnings.push(`Dates in "${sheetName}" could be month/day or day/month. They were read as month/day/year, so check the draw dates.`)
  return order === 'day'
}

function isPivotHeader(header: Cell[]): boolean {
  const k = header.slice(0, 3).map((c) => normKey(cellText(c)))
  return (
    ['test', 'test_name', 'name', 'marker'].includes(k[0]) &&
    ['reference_range', 'range', 'reference', 'ref_range', 'reported_reference_range_text'].includes(k[1]) &&
    ['units', 'unit', 'raw_units'].includes(k[2]) &&
    header.slice(3).some((c) => cellDate(c) !== null)
  )
}

function isRowHeader(header: Cell[]): boolean {
  const keys = new Set(header.map((c) => normKey(cellText(c))))
  return ALIASES.name.some((k) => keys.has(k)) && ALIASES.value.some((k) => keys.has(k)) && ALIASES.date.some((k) => keys.has(k))
}

const isDate = (cell: Cell | undefined): cell is { date: string } => Boolean(cell) && typeof cell === 'object'

function cellDate(cell: Cell | undefined, sheet?: Sheet, dayFirst = false): LooseDate | null {
  if (isDate(cell)) {
    const time = cell.date.slice(11, 16)
    return parseLooseDate(cell.date.slice(0, 10)) && { date: cell.date.slice(0, 10), time: time && time !== '00:00' ? time : null }
  }
  if (typeof cell === 'number' && cell > 20000 && cell < 80000) return { date: excelSerialToDate(cell, sheet?.date1904), time: null }
  return parseLooseDate(cellText(cell), { dayFirst })
}

export function cellText(cell: Cell | undefined): string {
  if (cell == null) return ''
  if (typeof cell === 'object') return cell.date
  return String(cell).trim()
}

function normKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
