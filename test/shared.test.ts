import { describe, expect, it } from 'vitest'
import { dayNumber, formatDate, parseLooseDate } from '../src/shared/dates'
import { normalizeAlias } from '../src/shared/markers'
import { deriveResultFields, parseLabValue, parseReferenceRange, rangeStatus } from '../src/shared/semantics'
import { correlation, pairSeries, slopePerYear, spearman } from '../src/shared/stats'
import { parseCsv, sheetsToDocument } from '../src/shared/tabular'

describe('semantics', () => {
  it('parses values with comparators and flag glyphs', () => {
    expect(parseLabValue('<0.5')).toMatchObject({ comparator: '<', numeric: 0.5 })
    expect(parseLabValue('<OR=19')).toMatchObject({ comparator: '<=', numeric: 19 })
    expect(parseLabValue('12.1 H')).toMatchObject({ numeric: 12.1, flag: 'high' })
    expect(parseLabValue('1,250')).toMatchObject({ numeric: 1250 })
    expect(parseLabValue('Negative')).toMatchObject({ comparator: 'text', numeric: null })
  })
  it('parses reference ranges', () => {
    expect(parseReferenceRange('3.8 - 10.8')).toMatchObject({ low: 3.8, high: 10.8 })
    expect(parseReferenceRange('<3.0')).toMatchObject({ low: null, high: 3 })
    expect(parseReferenceRange('<OR=19')).toMatchObject({ high: 19 })
    expect(parseReferenceRange('> OR = 60')).toMatchObject({ low: 60 })
    expect(parseReferenceRange('0.4 to 4.0')).toMatchObject({ low: 0.4, high: 4 })
    expect(parseReferenceRange('200 or below')).toMatchObject({ high: 200 })
    expect(parseReferenceRange('45231')).toBeNull()
  })
  it('derives flags: reported first, inferred otherwise, censored only when the bound is outside', () => {
    expect(deriveResultFields('11', '3.8-10.8', null)).toMatchObject({ lab_flag: 'high', flag_source: 'inferred' })
    expect(deriveResultFields('5', '3.8-10.8', 'L')).toMatchObject({ lab_flag: 'low', flag_source: 'reported' })
    expect(deriveResultFields('<0.3', '<3.0', null)).toMatchObject({ lab_flag: null, comparator: '<' })
    expect(rangeStatus(2, 3, 10, null)).toBe('low')
  })
  it('normalizes aliases', () => {
    expect(normalizeAlias('Ferritin, Serum')).toBe('ferritin')
    expect(normalizeAlias('C-Reactive Protein, Quant')).toBe('c reactive protein')
  })
})

describe('dates', () => {
  it('treats draw dates as calendar dates', () => {
    expect(formatDate('2018-12-15')).toBe('Dec 15, 2018')
    expect(dayNumber('2026-01-02') - dayNumber('2025-12-31')).toBe(2)
    expect(parseLooseDate('05/18/2026 08:48 AM')).toEqual({ date: '2026-05-18', time: '08:48' })
    expect(parseLooseDate('Apr-26')).toEqual({ date: '2026-04-01', time: null })
  })
})

describe('stats', () => {
  it('pairs draws within tolerance, closest first, each once', () => {
    const a = [{ day: 0, value: 1 }, { day: 10, value: 2 }]
    const b = [{ day: 1, value: 5 }, { day: 2, value: 6 }, { day: 30, value: 7 }]
    expect(pairSeries(a, b, 3).map((p) => [p.day, p.dayB])).toEqual([[0, 1]])
    expect(pairSeries(a, b, 0)).toHaveLength(0)
  })
  it('computes spearman with ties and correlation of changes', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1)
    const pairs = [1, 2, 3, 4, 5, 6].map((d, i) => ({ day: d, dayB: d, a: i, b: i % 2 ? i * 2 : i * 2 + 5 }))
    const c = correlation(pairs, 'pearson')!
    expect(c.n).toBe(6)
    expect(c.deltaN).toBe(5)
    expect(c.lo).toBeLessThan(c.r)
  })
  it('slope per year', () => {
    expect(slopePerYear([{ day: 0, value: 1 }, { day: 365.25, value: 2 }, { day: 730.5, value: 3 }])).toBeCloseTo(1)
  })
})

describe('tabular', () => {
  it('reads a pivoted history sheet with cycle day tags', () => {
    const doc = sheetsToDocument(
      [
        {
          name: 'Hormone',
          rows: [
            ['Test', 'Reference Range', 'Units', { date: '2024-06-10T00:00' }, { date: '2024-05-12T00:00' }],
            ['Cycle Day', null, null, 'Day 3', 'Day 1'],
            ['Testosterone', '9-48', 'ng/dL', 41.5, 22],
            ['Estradiol', null, 'pg/mL', '<25', null],
          ],
        },
      ],
      'xlsx',
    )
    expect(doc.panels.map((p) => p.draw_date)).toEqual(['2024-05-12', '2024-06-10'])
    const apr = doc.panels[1]
    expect(apr.tags).toEqual(['cycle day 3'])
    expect(apr.results.map((r) => [r.raw_name, r.raw_value, r.raw_test_category])).toEqual([
      ['Testosterone', '41.5', 'hormone'],
      ['Estradiol', '<25', 'hormone'],
    ])
  })
  it('reads row-oriented CSV', () => {
    const rows = parseCsv('test_name,drawn_at,raw_value,raw_units,reported_reference_range_text,facility\nCRP,2024-11-18T08:20:00+00:00,4.6,mg/L,<3.0,"Cascade, Lab"\n')
    const doc = sheetsToDocument([{ name: 'labs', rows }], 'csv')
    expect(doc.panels).toHaveLength(1)
    expect(doc.panels[0]).toMatchObject({ draw_date: '2024-11-18', draw_time: '08:20', facility: 'Cascade, Lab' })
  })
})

describe('strict bounds', () => {
  it('"<5.0" excludes 5.0', () => {
    expect(deriveResultFields('5.0', '<5.0', null).lab_flag).toBe('high')
    expect(deriveResultFields('5.0', '<=5.0', null).lab_flag).toBeNull()
    expect(deriveResultFields('5.0', '0-5.0', null).lab_flag).toBeNull()
  })
})

import { numericUnitKey, unitKey } from '../src/shared/units'
describe('units', () => {
  it('treats notation variants as the same unit', () => {
    expect(unitKey('10³/uL')).toBe(unitKey('10*3/uL'))
    expect(unitKey('K/uL')).toBe(unitKey('10*3/uL'))
    expect(unitKey('mEq/L')).toBe(unitKey('mmol/L'))
    expect(unitKey('mcg/dL')).toBe(unitKey('ug/dL'))
    expect(unitKey('mL/min/1.73m²')).toBe(unitKey('mL/min/1.73m*2'))
    expect(unitKey('mg/dL')).not.toBe(unitKey('mmol/L'))
  })
  it('ignores letter case and hour spellings, but keeps mEq/L apart for math', () => {
    expect(numericUnitKey('mm/Hr')).toBe(numericUnitKey('mm/hr'))
    expect(numericUnitKey('mm/hr')).toBe(numericUnitKey('mm/h'))
    expect(numericUnitKey('mg/dl')).toBe(numericUnitKey('mg / dL'))
    expect(numericUnitKey('mEq/L')).not.toBe(numericUnitKey('mmol/L'))
  })
})
