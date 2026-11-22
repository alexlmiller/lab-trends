import { correlationFor } from '../src/client/lib/correlate'
import { describe, expect, it } from 'vitest'
import { activeOn, chartOccurrences, validatedPeriods } from '../src/shared/events'
import type { MarkerSeries, Panel, Result, TimelineEvent } from '../src/shared/types'
import { priorResult, resultChange } from '../src/client/lib/report'
import { relativeToReference } from '../src/shared/semantics'

const result = (overrides: Partial<Result> = {}): Result => ({
  id: 'demo',
  panel_id: 'draw-a',
  marker_id: 'marker',
  draw_date: '2026-02-01',
  draw_time: null,
  raw_name: 'Example',
  raw_value: '3.0',
  comparator: '=',
  value_numeric: 3,
  raw_units: 'mg/L',
  reference_text: null,
  ref_low: null,
  ref_high: null,
  lab_flag: null,
  flag_source: null,
  notes: null,
  corrected_at: null,
  facility: null,
  panel_tags: [],
  ...overrides,
})

describe('event periods', () => {
  it('sorts calendar dates and leaves gaps between periods', () => {
    const periods = validatedPeriods([
      { start_date: '2026-03-01', ongoing: true },
      { start_date: '2026-01-10', end_date: '2026-01-15' },
      { start_date: '2026-02-01' },
    ])
    const occurrences = chartOccurrences([{ id: 'visits', periods } as TimelineEvent])
    expect(new Set(occurrences.map((p) => p.id)).size).toBe(3)
    const active = (date: string) => occurrences.some((p) => activeOn(p, date))
    expect(active('2026-01-15')).toBe(true)
    expect(active('2026-01-16')).toBe(false)
    expect(active('2026-02-01')).toBe(true)
    expect(active('2026-02-02')).toBe(false)
    expect(active('2026-09-01')).toBe(true)
  })
  it('rejects overlaps, impossible dates and conflicting endpoints', () => {
    for (const input of [
      [],
      [{ start_date: '2026-02-29' }],
      [{ start_date: '2026-05-01', end_date: '2026-04-01' }],
      [{ start_date: '2026-01-01', ongoing: true }, { start_date: '2026-06-01' }],
      [{ start_date: '2026-01-01', ongoing: true, end_date: '2026-02-01' }],
    ])
      expect(() => validatedPeriods(input)).toThrow()
    expect(validatedPeriods([{ start_date: '2024-02-29' }])).toHaveLength(1)
  })
  it('keeps a trimmed note on each period and travels with it when sorted', () => {
    const periods = validatedPeriods([
      { start_date: '2026-03-01', ongoing: true, note: '  15 mg weekly ' },
      { start_date: '2026-01-10', end_date: '2026-01-15', note: '' },
    ])
    expect(periods.map((p) => p.note)).toEqual([null, '15 mg weekly'])
    expect(validatedPeriods([{ start_date: '2026-01-01', note: 'x'.repeat(800) }])[0].note).toHaveLength(500)
    expect(() => validatedPeriods([{ start_date: '2026-01-01', note: 5 }])).toThrow()
  })
})

describe('reported comparisons', () => {
  it('classifies a reading using only its reported reference limits', () => {
    expect(relativeToReference(result({ lab_flag: 'critical' }))).toBeUndefined()
    expect(relativeToReference(result({ ref_low: 2, ref_high: 3 }))).toBe('in')
    expect(relativeToReference(result({ reference_text: '<3', ref_high: 3 }))).toBe('high')
    expect(relativeToReference(result({ reference_text: '≤3', ref_high: 3 }))).toBe('in')
    expect(relativeToReference(result({ reference_text: '>3', ref_low: 3 }))).toBe('low')
    expect(relativeToReference(result({ comparator: '<=', ref_low: 3 }))).toBeUndefined()
    expect(relativeToReference(result({ comparator: '<', ref_low: 3 }))).toBe('low')
    expect(relativeToReference(result({ comparator: '>=', ref_high: 3 }))).toBeUndefined()
    expect(relativeToReference(result({ comparator: '>', ref_high: 3 }))).toBe('high')
    expect(relativeToReference(result({ comparator: 'text', value_numeric: null, ref_low: 2 }))).toBeUndefined()
  })
  it('shows differences only for comparable exact measurements', () => {
    const up = resultChange(result(), result({ value_numeric: 3.3 }))
    expect(up).toMatchObject({ value: '+0.3', unit: 'mg/L', note: 'Higher' })
    expect(up.ratio).toBeCloseTo(0.1)
    // No percentage from zero, and none where no difference is given.
    expect(resultChange(result({ value_numeric: 0 }), result()).ratio).toBeUndefined()
    expect(resultChange(result(), result({ comparator: '<' })).ratio).toBeUndefined()
    expect(resultChange(result({ raw_units: 'µg/L' }), result({ raw_units: 'ug/L', value_numeric: 0 })).value).toBe('−3')
    for (const other of [undefined, result({ comparator: '<' }), result({ raw_units: null }), result({ raw_units: 'mg/dL' })])
      expect(resultChange(result(), other).value).toBe('—')
    expect(resultChange(result({ raw_units: 'mEq/L' }), result({ raw_units: 'mmol/L' })).note).toBe('Different units')
    expect(resultChange(result({ raw_units: 'mg/dl' }), result({ raw_units: 'mg / dL' })).value).toBe('0')
    expect(resultChange(result({ raw_units: 'mm/Hr' }), result({ raw_units: 'mm/hr', value_numeric: 5 })).value).toBe('+2')
    const text = result({ raw_value: 'Negative', value_numeric: null, comparator: 'text' })
    expect(resultChange(text, text).value).toBe('Same result')
  })
  it('excludes future draws and the selected draw itself from the previous reading', () => {
    const early = result({ draw_date: '2026-01-01' })
    const sameDay = result({ panel_id: 'draw-b', draw_time: '08:00' })
    const late = result({ panel_id: 'draw-c', draw_time: '10:00' })
    const marker = { results: [early, sameDay, late] } as MarkerSeries
    expect(priorResult(marker, { id: 'draw-b', draw_date: sameDay.draw_date, draw_time: '08:00' } as Panel)).toBe(early)
    expect(priorResult(marker, { id: 'draw-c', draw_date: sameDay.draw_date, draw_time: '10:00' } as Panel)).toBe(sameDay)
  })
})

it('recomputes relationships after same-length corrections or switching datasets', () => {
  function series(id: string, values: number[]) {
    return {
      id,
      results: values.map((value, i) => result({ draw_date: '2026-01-0' + (i + 1), value_numeric: value })),
    } as MarkerSeries
  }
  const opts = { method: 'spearman' as const, tol: 0 }
  const a = series('a', [1, 2, 3, 4])
  expect(correlationFor(a, series('b', [2, 4, 6, 8]), opts)?.r).toBe(1)
  expect(correlationFor(a, series('b', [8, 6, 4, 2]), opts)?.r).toBe(-1)
})
