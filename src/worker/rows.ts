// Database rows to the shapes the client reads, and the column lists the
// queries share. Naming columns keeps a query from hauling fields nobody reads.
import type { EventKind, EventPeriod, Marker, Panel, Result, TimelineEvent } from '../shared/types'
import { parseJson } from './lib'

export const MARKER_COLUMNS = 'id, slug, name, long_name, loinc_code, category, default_units, description, related_slugs, is_custom, status'

/** Result columns the client reads; `r` is lab_results and `p` its lab_panels row. */
export const RESULT_COLUMNS = `r.id, r.panel_id, r.marker_id, r.raw_name, r.raw_value, r.comparator, r.value_numeric, r.raw_units, r.reference_text,
  r.ref_low, r.ref_high, r.lab_flag, r.flag_source, r.notes, r.corrected_at, p.draw_date, p.draw_time, p.facility, p.tags AS panel_tags`

/** A whole lab_results row as JSON, for the revision log. Used inside a statement that selects FROM lab_results. */
export const RESULT_JSON = `json_object('id', id, 'panel_id', panel_id, 'subject_id', subject_id, 'marker_id', marker_id, 'raw_name', raw_name,
  'raw_value', raw_value, 'comparator', comparator, 'value_numeric', value_numeric, 'value_text', value_text, 'raw_units', raw_units,
  'reference_text', reference_text, 'ref_low', ref_low, 'ref_high', ref_high, 'lab_flag', lab_flag, 'flag_source', flag_source, 'notes', notes,
  'source_excerpt', source_excerpt, 'source_row_id', source_row_id, 'corrected_at', corrected_at, 'corrected_by', corrected_by,
  'created_at', created_at, 'updated_at', updated_at)`

type Row = Record<string, unknown>

export function num(v: unknown): number | null {
  return v == null || v === '' ? null : Number(v)
}

const text = (v: unknown): string | null => (v as string | null | undefined) ?? null

export function markerOut(m: Row): Marker {
  return {
    id: String(m.id),
    slug: String(m.slug),
    name: String(m.name),
    long_name: text(m.long_name),
    loinc_code: text(m.loinc_code),
    category: String(m.category ?? 'uncategorized'),
    default_units: text(m.default_units),
    description: text(m.description),
    related_slugs: parseJson(m.related_slugs, []),
    is_custom: Boolean(m.is_custom),
    status: String(m.status),
  }
}

export function resultOut(r: Row): Result {
  return {
    id: String(r.id),
    panel_id: String(r.panel_id),
    marker_id: String(r.marker_id),
    draw_date: String(r.draw_date),
    draw_time: text(r.draw_time),
    raw_name: text(r.raw_name),
    raw_value: String(r.raw_value),
    comparator: text(r.comparator),
    value_numeric: num(r.value_numeric),
    raw_units: text(r.raw_units),
    reference_text: text(r.reference_text),
    ref_low: num(r.ref_low),
    ref_high: num(r.ref_high),
    lab_flag: text(r.lab_flag),
    flag_source: text(r.flag_source),
    notes: text(r.notes),
    corrected_at: text(r.corrected_at),
    facility: text(r.facility),
    panel_tags: parseJson(r.panel_tags, []),
  }
}

export function panelOut(p: Row, sources: Panel['sources'] = [], counts = { results: 0, flagged: 0 }): Panel {
  return {
    id: String(p.id),
    draw_date: String(p.draw_date),
    draw_time: text(p.draw_time),
    facility: text(p.facility),
    ordering_provider: text(p.ordering_provider),
    accession_number: text(p.accession_number),
    panel_name: text(p.panel_name),
    notes: text(p.notes),
    tags: parseJson(p.tags, []),
    sources,
    result_count: counts.results,
    flagged_count: counts.flagged,
  }
}

export function eventOut(e: Row): TimelineEvent {
  const first = { start_date: String(e.start_date), end_date: text(e.end_date), ongoing: !e.end_date && Boolean(e.ongoing), note: text(e.period_note) }
  return {
    id: String(e.id),
    kind: e.kind as EventKind,
    label: String(e.label),
    ...first,
    updated_at: String(e.updated_at),
    periods: [first, ...parseJson<EventPeriod[]>(e.additional_periods, [])],
    notes: text(e.notes),
    marker_ids: parseJson(e.marker_ids, []),
  }
}
