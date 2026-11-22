// Deterministic CSV/XLSX → ExtractionDocument. Two layouts are recognised:
//  - row-oriented: one row per result with test/value/date columns
//  - pivoted history: Test | Reference Range | Units | <date> | <date> ...
//    (the layout of a hand-kept lab history spreadsheet; one tab per panel)
import { excelSerialToDate, parseLooseDate } from './dates'
import { normalizeCategory } from './categories'
import { normalizeFlag, normalizeReferenceText, parseLabValue } from './semantics'
import type { ExtractedPanel, ExtractedResult, ExtractionDocument } from './types'
import type { Cell, Sheet } from './xlsx'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
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

export function sheetsToDocument(sheets: Sheet[], kind: 'csv' | 'xlsx'): ExtractionDocument {
  const byDate = new Map<string, ExtractedPanel>()
  const warnings: string[] = []
  const panelFor = (date: string, time: string | null, extra?: Partial<ExtractedPanel>) => {
    const key = `${date}|${extra?.facility ?? ''}|${extra?.accession_number ?? ''}`
    let panel = byDate.get(key)
    if (!panel) {
      panel = { draw_date: date, draw_time: time, results: [], tags: [], warnings: [], ...extra }
      byDate.set(key, panel)
    }
    return panel
  }

  for (const sheet of sheets) {
    const rows = sheet.rows.filter((r) => r.some((c) => cellText(c) !== ''))
    if (!rows.length) continue
    const header = rows[0]
    if (isPivotHeader(header)) {
      readPivot(sheet.name, rows, panelFor, warnings)
    } else if (isRowHeader(header)) {
      readRows(sheet.name, rows, panelFor, warnings)
    } else if (sheets.length === 1) {
      warnings.push(`Could not recognise the columns in "${sheet.name}". Expected test/value/date columns or a Test | Reference Range | Units | dates layout.`)
    }
  }
  const panels = [...byDate.values()].filter((p) => p.results.length).sort((a, b) => (a.draw_date ?? '').localeCompare(b.draw_date ?? ''))
  for (const p of panels) p.tags = [...new Set(p.tags)]
  return { source_kind: kind, panels, document_warnings: warnings }
}

type PanelFor = (date: string, time: string | null, extra?: Partial<ExtractedPanel>) => ExtractedPanel

function readPivot(sheetName: string, rows: Cell[][], panelFor: PanelFor, warnings: string[]) {
  const header = rows[0]
  const dateCols: { col: number; date: string }[] = []
  for (let col = 3; col < header.length; col++) {
    const d = headerDate(header[col])
    if (d) dateCols.push({ col, date: d })
  }
  const category = normalizeCategory(sheetName)
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const name = cellText(row[0])
    if (!name) continue
    const reference = normalizeReferenceText(cellText(row[1]))
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
      const parsed = parseLabValue(raw)
      panelFor(date, null).results.push({
        raw_name: name,
        raw_test_category: category,
        raw_value: raw,
        comparator: parsed.comparator,
        raw_units: units,
        reference_text: reference,
        lab_flag: parsed.flag ?? null,
        source_row_id: `${sheetName}!R${r + 1}C${col + 1}`,
      })
    }
  }
  if (!dateCols.length) warnings.push(`"${sheetName}" looks like a pivoted history but no date columns were found.`)
}

const ALIASES: Record<string, string[]> = {
  name: ['test_name', 'test', 'name', 'analyte', 'component', 'marker'],
  value: ['raw_value', 'value', 'result'],
  date: ['drawn_at', 'date', 'collection_date', 'collected', 'draw_date', 'collected_at'],
  units: ['raw_units', 'units', 'unit'],
  reference: ['reported_reference_range_text', 'reference_range', 'range', 'reference', 'ref_range'],
  flag: ['lab_flag', 'flag', 'abnormal'],
  category: ['category', 'panel', 'panel_name', 'panel_template_name'],
  facility: ['facility', 'lab', 'source_facility', 'performing_lab'],
  provider: ['ordering_provider', 'provider'],
  accession: ['accession_number', 'accession'],
  rowId: ['source_row_id', 'row_id', 'id'],
  notes: ['notes', 'note', 'comment'],
}

function readRows(sheetName: string, rows: Cell[][], panelFor: PanelFor, warnings: string[]) {
  const keys = rows[0].map((c) => normKey(cellText(c)))
  const idx = (field: keyof typeof ALIASES) => keys.findIndex((k) => ALIASES[field].includes(k))
  const col = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, idx(f as keyof typeof ALIASES)])) as Record<keyof typeof ALIASES, number>
  let bad = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const get = (c: number) => (c >= 0 ? cellText(row[c]) : '')
    const name = get(col.name)
    const raw = get(col.value)
    if (!name || !raw) continue
    const when = col.date >= 0 ? cellDate(row[col.date]) : null
    if (!when) {
      bad++
      continue
    }
    const parsed = parseLabValue(raw)
    const result: ExtractedResult = {
      raw_name: name,
      raw_test_category: get(col.category) ? normalizeCategory(get(col.category)) : null,
      raw_value: raw,
      comparator: parsed.comparator,
      raw_units: get(col.units) || null,
      reference_text: normalizeReferenceText(get(col.reference)),
      lab_flag: normalizeFlag(get(col.flag)) ?? parsed.flag ?? null,
      source_row_id: get(col.rowId) || `${sheetName}!R${r + 1}`,
    }
    const notes = get(col.notes)
    if (notes) result.warnings = [`note: ${notes}`]
    panelFor(when.date, when.time, {
      facility: get(col.facility) || null,
      ordering_provider: get(col.provider) || null,
      accession_number: get(col.accession) || null,
    }).results.push(result)
  }
  if (bad) warnings.push(`${bad} row(s) in "${sheetName}" had no readable date and were skipped.`)
}

function isPivotHeader(header: Cell[]): boolean {
  const k = header.slice(0, 3).map((c) => normKey(cellText(c)))
  return (
    ['test', 'test_name', 'name', 'marker'].includes(k[0]) &&
    ['reference_range', 'range', 'reference', 'ref_range', 'reported_reference_range_text'].includes(k[1]) &&
    ['units', 'unit', 'raw_units'].includes(k[2]) &&
    header.slice(3).some((c) => headerDate(c) !== null)
  )
}

function isRowHeader(header: Cell[]): boolean {
  const keys = new Set(header.map((c) => normKey(cellText(c))))
  return ALIASES.name.some((k) => keys.has(k)) && ALIASES.value.some((k) => keys.has(k)) && ALIASES.date.some((k) => keys.has(k))
}

function headerDate(cell: Cell): string | null {
  if (cell && typeof cell === 'object' && 'date' in cell) return cell.date.slice(0, 10)
  if (typeof cell === 'number' && cell > 20000 && cell < 80000) return excelSerialToDate(cell)
  return parseLooseDate(cellText(cell))?.date ?? null
}

function cellDate(cell: Cell): { date: string; time: string | null } | null {
  if (cell && typeof cell === 'object' && 'date' in cell) {
    const time = cell.date.slice(11, 16)
    return { date: cell.date.slice(0, 10), time: time && time !== '00:00' ? time : null }
  }
  if (typeof cell === 'number' && cell > 20000 && cell < 80000) return { date: excelSerialToDate(cell), time: null }
  return parseLooseDate(cellText(cell))
}

export function cellText(cell: Cell | undefined): string {
  if (cell == null) return ''
  if (typeof cell === 'object') return cell.date
  return String(cell).trim()
}

function normKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
