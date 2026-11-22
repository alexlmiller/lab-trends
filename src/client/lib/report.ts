import { parseReferenceRange } from '../../shared/semantics'
import type { MarkerSeries, Panel, Result } from '../../shared/types'
import { numericUnitKey } from '../../shared/units'
import { statusOf } from './series'

export function priorResult(marker: MarkerSeries, draw: Panel) {
  return marker.results.findLast(
    (r) =>
      r.draw_date < draw.draw_date ||
      (r.draw_date === draw.draw_date &&
        ((r.draw_time ?? '') < (draw.draw_time ?? '') || (r.draw_time === draw.draw_time && r.panel_id < draw.id))),
  )
}

export function resultLabel(r: Result): string {
  if (r.lab_flag === 'critical') return 'Critical flag'
  if (r.lab_flag === 'abnormal') return 'Flagged'
  if (!r.lab_flag && r.comparator && r.comparator !== '=') return 'As reported'
  const status = statusOf(r)
  return { low: 'Below range', high: 'Above range', in: 'In range', unknown: 'As reported' }[status]
}

export function resultChange(a?: Result, b?: Result): { value: string; unit?: string; note: string } {
  if (!a || !b) return { value: '—', note: 'Needs two results' }
  if (a.comparator === 'text' && b.comparator === 'text')
    return { value: a.raw_value === b.raw_value ? 'Same result' : 'Changed', note: '' }
  if (a.value_numeric == null || b.value_numeric == null || (a.comparator ?? '=') !== '=' || (b.comparator ?? '=') !== '=')
    return { value: '—', note: 'Values as reported' }
  const units = numericUnitKey(a.raw_units)
  const nextUnits = numericUnitKey(b.raw_units)
  if (!units || !nextUnits) return { value: '—', note: 'Units unavailable' }
  if (units !== nextUnits) return { value: '—', note: 'Different units' }
  const delta = b.value_numeric - a.value_numeric
  const absolute = Number(Math.abs(delta).toPrecision(12))
  return {
    value: (delta < 0 ? '−' : delta > 0 ? '+' : '') + absolute,
    unit: b.raw_units ?? '',
    note: delta < 0 ? 'Lower' : delta > 0 ? 'Higher' : 'Unchanged',
  }
}

/** A reported limit only classifies a censored reading if every possible value is on the same side. */
export function relativeToReference(
  result: Pick<Result, 'ref_low' | 'ref_high' | 'reference_text' | 'value_numeric' | 'comparator'>,
) {
  const { ref_low: low, ref_high: high, value_numeric: value, comparator } = result
  if (value == null || (low == null && high == null) || (low != null && high != null && low > high)) return undefined
  const exact = (comparator ?? '=') === '='
  const strict = parseReferenceRange(result.reference_text)?.strict === true
  if (
    low != null &&
    (exact || comparator === '<' || comparator === '<=') &&
    (value < low || (value === low && (strict || comparator === '<')))
  )
    return 'low'
  if (
    high != null &&
    (exact || comparator === '>' || comparator === '>=') &&
    (value > high || (value === high && (strict || comparator === '>')))
  )
    return 'high'
  return exact ? 'in' : undefined
}
