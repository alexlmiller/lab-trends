import type { MarkerSeries, Panel, Result } from '../../shared/types'
import { numericUnitKey } from '../../shared/units'

export function priorResult(marker: MarkerSeries, draw: Panel) {
  return marker.results.findLast(
    (r) =>
      r.draw_date < draw.draw_date ||
      (r.draw_date === draw.draw_date &&
        ((r.draw_time ?? '') < (draw.draw_time ?? '') || (r.draw_time === draw.draw_time && r.panel_id < draw.id))),
  )
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
