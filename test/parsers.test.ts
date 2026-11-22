// What reports actually print. Each table is "as printed" against "what it
// means". A text the parser does not fully understand must give no number, no
// band and no flag: a result that is not read can be fixed in review, a result
// that is read wrong cannot be seen.
import { describe, expect, it } from 'vitest'
import { formatDate, isValidDate, parseLooseDate, slashDateOrder } from '../src/shared/dates'
import { normalizeAlias, slugify } from '../src/shared/markers'
import { layoutPage } from '../src/shared/pdfLayout'
import { deriveResultFields, isOutOfRange, normalizeFlag, parseLabValue, parseReferenceRange, relativeToReference, resultStatus, toNumber } from '../src/shared/semantics'
import { parseCsv, sheetsToDocument } from '../src/shared/tabular'
import { splitText } from '../src/worker/chunking'

const band = (text: string) => {
  const r = parseReferenceRange(text)
  return r ? [r.low, r.high] : null
}

describe('reference ranges', () => {
  it.each([
    ['600 - 1,500 mg/dL', [600, 1500]],
    ['4,000-11,000', [4000, 11000]],
    ['150,000 - 450,000', [150000, 450000]],
    ['150 000 - 400 000', [150000, 400000]],
    ['<1,000', [null, 1000]],
    ['3,8 - 10,8', [3.8, 10.8]],
    ['<0,5', [null, 0.5]],
    ['.5 - 1.5', [0.5, 1.5]],
    ['−2.0 - 2.0', [-2, 2]],
    ['-2.0 - 2.0', [-2, 2]],
    ['-10 - -5', [-10, -5]],
    ['1.5E3 - 4.5E3', [1500, 4500]],
    ['3.8−10.8', [3.8, 10.8]],
    ['3.8–10.8', [3.8, 10.8]],
    ['70 mg/dL - 99 mg/dL', [70, 99]],
    ['40%-60%', [40, 60]],
    ['70-99 mg/dL', [70, 99]],
    ['0.4 to 4.0', [0.4, 4]],
    ['4.0-11.0 x10E3/uL', [4, 11]],
    ['4.0 - 11.0 10^3/uL', [4, 11]],
    ['0-5 /HPF', [0, 5]],
    ['0 - 5 cells/mm3', [0, 5]],
    ['Desirable: <200', [null, 200]],
    ['Normal range: 70 - 99 mg/dL', [70, 99]],
    ['=<200', [null, 200]],
    ['≤5', [null, 5]],
    ['> OR = 60', [60, null]],
    ['>59 mL/min/1.73', [59, null]],
    ['less than 5', [null, 5]],
    ['up to 40', [null, 40]],
    ['200 or below', [null, 200]],
    ['60 mL/min or above', [60, null]],
    ['> 5 and < 10', [5, 10]],
  ])('%s', (text, expected) => expect(band(text)).toEqual(expected))

  it.each([
    // More than one range: which applies depends on the person, so none is assumed.
    '18-49 years: 2.0-7.0',
    '20 - 29 yrs: 83 - 257',
    'M: 13.5-17.5 F: 12.0-15.5',
    'Low risk: <1.0; Avg: 1.0-3.0; High: >3.0',
    // A range a spreadsheet turned into a date, and other things that are not ranges.
    '1-5-2026',
    '<1:80',
    'Negative',
    'Not Estab.',
    '10 - 5',
    'See note 4 on page 2 for the 2019 change in method',
  ])('gives no band for "%s"', (text) => expect(band(text)).toEqual([null, null]))

  it('treats a date in the range column as no range at all', () => {
    expect(parseReferenceRange('2026-01-05T00:00')).toBeNull()
    expect(parseReferenceRange('45231')).toBeNull()
  })

  it('flags against the range it was given, never a misread one', () => {
    // The bug this file exists for: 900 and 1200 inside 600 - 1,500 were flagged high.
    expect(deriveResultFields('900', '600 - 1,500 mg/dL', null).lab_flag).toBeNull()
    expect(deriveResultFields('1200', '600 - 1,500 mg/dL', null).lab_flag).toBeNull()
    expect(deriveResultFields('1600', '600 - 1,500 mg/dL', null)).toMatchObject({ lab_flag: 'high', flag_source: 'inferred' })
    expect(deriveResultFields('4.5', '3,8 - 10,8', null).lab_flag).toBeNull()
    // An age-banded range must not flag a value by the ages.
    expect(deriveResultFields('5', '18-49 years: 2.0-7.0', null)).toMatchObject({ lab_flag: null, ref_low: null, ref_high: null })
    expect(deriveResultFields('0.5', 'Low risk: <1.0; Avg: 1.0-3.0; High: >3.0', null).lab_flag).toBeNull()
  })
})

describe('values', () => {
  it.each([
    ['1,234', 1234],
    ['2,350', 2350],
    ['0,500', 0.5],
    ['4,5', 4.5],
    ['.5', 0.5],
    ['−2.0', -2],
    ['1.2E+3', 1200],
    ['45%', 45],
    ['13.300000000000001', 13.300000000000001],
    ['150 000', 150000],
    ['1,234.5', 1234.5],
  ])('%s', (text, expected) => expect(parseLabValue(text)).toMatchObject({ comparator: '=', numeric: expected }))

  it('keeps the comparator and the flag printed with a value', () => {
    expect(parseLabValue('<0,005')).toMatchObject({ comparator: '<', numeric: 0.005 })
    expect(parseLabValue('≤5')).toMatchObject({ comparator: '<=', numeric: 5 })
    expect(parseLabValue('<1,000')).toMatchObject({ comparator: '<', numeric: 1000 })
    expect(parseLabValue('7.1 (H)')).toMatchObject({ numeric: 7.1, flag: 'high' })
    expect(parseLabValue('5.2 High')).toMatchObject({ numeric: 5.2, flag: 'high' })
    expect(parseLabValue('2.1 LL')).toMatchObject({ numeric: 2.1, flag: 'critical' })
    expect(parseLabValue('102*')).toMatchObject({ numeric: 102, flag: 'abnormal' })
  })

  it.each(['Negative', '1:80', '1+', '2025-03-04', '1,23,456', '1.2.3', '5 10', 'Trace'])('leaves "%s" as text', (text) => {
    expect(parseLabValue(text)).toMatchObject({ comparator: 'text', numeric: null })
  })

  it('reads one number, or none', () => {
    expect(toNumber('1.234,5')).toBe(1234.5)
    expect(toNumber('')).toBeNull()
    expect(toNumber('1,2,3')).toBeNull()
  })
})

describe('flags', () => {
  it.each(['No', 'None', '-', 'N/A', 'FALSE', '0', 'WNL', 'Within range', 'Final', 'Normal', 'N', 'Not flagged', 'High normal', 'hemolyzed', 'lipemic'])('"%s" is not a flag', (word) => {
    expect(normalizeFlag(word)).toBeNull()
  })

  it.each([
    ['H', 'high'],
    ['High', 'high'],
    ['(H)', 'high'],
    ['Above range', 'high'],
    ['↑', 'high'],
    ['L', 'low'],
    ['Low', 'low'],
    ['Below range', 'low'],
    ['HH', 'critical'],
    ['LL', 'critical'],
    ['Critical Low', 'critical'],
    ['Panic', 'critical'],
    ['A', 'abnormal'],
    ['Abnormal', 'abnormal'],
    ['*', 'abnormal'],
    ['Yes', 'abnormal'],
    ['Abnormal high', 'high'],
  ])('"%s" is %s', (word, flag) => expect(normalizeFlag(word)).toBe(flag))

  it('never turns a flag without a direction into "high"', () => {
    const base = { value_numeric: 2.1, comparator: '=', ref_low: null, ref_high: null }
    expect(resultStatus({ ...base, lab_flag: 'critical' })).toBe('flagged')
    expect(resultStatus({ ...base, lab_flag: 'abnormal' })).toBe('flagged')
    // With a range, the range says which way.
    expect(resultStatus({ ...base, ref_low: 3.5, ref_high: 5, lab_flag: 'critical' })).toBe('low')
    expect(resultStatus({ value_numeric: 140, ref_low: 135, ref_high: 145, lab_flag: null })).toBe('in')
    expect(isOutOfRange({ ...base, lab_flag: 'abnormal' })).toBe(true)
    // A sodium of 140 in a sheet whose "Abnormal" column says No is simply in range.
    expect(deriveResultFields('140', '135-145', 'No')).toMatchObject({ lab_flag: null, flag_source: null })
  })

  it('places a censored value only when every value it allows is on one side', () => {
    const r = (comparator: string, value: number, low: number | null, high: number | null) => relativeToReference({ value_numeric: value, comparator, ref_low: low, ref_high: high })
    expect(r('<', 0.3, null, 3)).toBe('in')
    expect(r('<', 5, null, 3)).toBeUndefined()
    expect(r('>', 100, 60, null)).toBe('in')
    expect(r('>', 100, null, 90)).toBe('high')
    expect(r('<', 2, 3, 10)).toBe('low')
    expect(r('<', 5, 3, 10)).toBeUndefined()
  })
})

describe('dates', () => {
  it.each([
    ['2025-03-04', '2025-03-04', null],
    ['2025-03-04T23:30:00-08:00', '2025-03-04', '23:30'],
    ['2025-03-04 8:15 PM', '2025-03-04', '20:15'],
    ['20250304', '2025-03-04', null],
    ['3/4/2025', '2025-03-04', null],
    ['13/04/2025', '2025-04-13', null],
    ['4/3/99', '1999-04-03', null],
    ['04.03.2025', '2025-03-04', null],
    ['Mar 4, 2025', '2025-03-04', null],
    ['4 Mar 2025', '2025-03-04', null],
    ['04-Mar-25', '2025-03-04', null],
    ['September 2023', '2023-09-01', null],
  ])('%s', (text, date, time) => expect(parseLooseDate(text)).toEqual({ date, time }))

  it.each(['02/30/2025', '13/13/2025', '2025-13-04', 'Marker 12', 'Mayo 2023', 'Decision 2024', '45720', ''])('rejects "%s"', (text) => expect(parseLooseDate(text)).toBeNull())

  it('reads slash dates day first only when told to or when the numbers leave no choice', () => {
    expect(parseLooseDate('04/03/2025')?.date).toBe('2025-04-03')
    expect(parseLooseDate('04/03/2025', { dayFirst: true })?.date).toBe('2025-03-04')
    expect(slashDateOrder(['04/03/2025', '25/03/2025'])).toBe('day')
    expect(slashDateOrder(['04/03/2025', '03/25/2025'])).toBe('month')
    expect(slashDateOrder(['04/03/2025', '05/06/2025'])).toBe('unclear')
    expect(slashDateOrder(['25/03/2025', '03/25/2025'])).toBe('mixed')
    expect(slashDateOrder(['2025-03-04'])).toBeNull()
  })

  it('knows a real date from one that only looks like it, and never prints "undefined"', () => {
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2025-02-29')).toBe(false)
    expect(isValidDate('2025-13-04')).toBe(false)
    expect(isValidDate('1899-12-30')).toBe(false)
    expect(formatDate('2025-13-04')).toBe('2025-13-04')
  })
})

describe('test names', () => {
  it('keeps what tells two tests apart', () => {
    expect(normalizeAlias('Neutrophils %')).toBe('neutrophils percent')
    expect(normalizeAlias('Neutrophils #')).toBe('neutrophils absolute')
    expect(normalizeAlias('NEUT%')).not.toBe(normalizeAlias('NEUT#'))
    expect(normalizeAlias('Ferritin, Serum')).toBe('ferritin')
    expect(normalizeAlias('Глюкоза')).toBe('глюкоза')
    expect(normalizeAlias('Глюкоза')).not.toBe(normalizeAlias('Гемоглобин'))
    expect(normalizeAlias('血糖')).toBe('血糖')
    expect(normalizeAlias('Hémoglobine')).toBe('hémoglobine')
  })
  it('never gives an empty key to a name that has letters', () => {
    expect(normalizeAlias('Blood')).toBe('blood')
    expect(normalizeAlias('Total')).toBe('total')
    expect(normalizeAlias('%')).toBe('percent')
    expect(normalizeAlias('---')).toBe('')
    expect(slugify('Neutrophils #')).toBe('neutrophils-absolute')
    expect(slugify('Глюкоза')).toBe('')
  })
})

describe('spreadsheets and CSV', () => {
  const doc = (text: string) => sheetsToDocument([{ name: 'labs', rows: parseCsv(text) }], 'csv')
  const rows = (text: string) => doc(text).panels.flatMap((p) => p.results.map((r) => [r.raw_name, r.raw_value, p.draw_date]))

  it('reads semicolon and tab files, and a header under a title row', () => {
    expect(rows('Test;Value;Date\nGlucose;5,4;2025-03-04\n')).toEqual([['Glucose', '5,4', '2025-03-04']])
    expect(rows('Test\tValue\tDate\nGlucose\t90\t2025-03-04\n')).toEqual([['Glucose', '90', '2025-03-04']])
    expect(rows('My lab history\n\nTest Name,Result,Date Collected\nGlucose,90,2025-03-04\n')).toEqual([['Glucose', '90', '2025-03-04']])
  })
  it('takes the test column for the test, not a patient "Name" column before it', () => {
    expect(rows('Name,Test,Value,Date\nJane Doe,Glucose,90,2025-03-04\n')).toEqual([['Glucose', '90', '2025-03-04']])
  })
  it('keeps a quote inside a field as a quote, so it cannot swallow the rows after it', () => {
    expect(rows('Test,Value,Date,Notes\nHeight,70,2025-03-04,5\'10" tall\nGlucose,90,2025-03-04,\nSodium,140,2025-03-04,\n')).toHaveLength(3)
    expect(parseCsv('a,"b,""c"""\n')).toEqual([['a', 'b,"c"']])
  })
  it('reads day-first files day first, and says so when it cannot tell', () => {
    expect(rows('Test,Value,Date\nA,1,04/03/2025\nB,2,25/03/2025\n')).toEqual([['A', '1', '2025-03-04'], ['B', '2', '2025-03-25']])
    expect(doc('Test,Value,Date\nA,1,04/03/2025\n').document_warnings.join(' ')).toMatch(/could be month\/day or day\/month/)
    expect(doc('Test,Value,Date\nA,1,03/25/2025\n').document_warnings).toEqual([])
  })
  it('does not flag a row because its flag column says No', () => {
    const d = doc('Test,Value,Range,Abnormal,Date\nSodium,140,135-145,No,2025-03-04\nPotassium,6.1,3.5-5.0,Yes,2025-03-04\n')
    expect(d.panels[0].results.map((r) => r.lab_flag)).toEqual([null, 'abnormal'])
  })
  it('says what it left out', () => {
    const d = sheetsToDocument(
      [
        { name: 'CBC', rows: [['Test', 'Value', 'Date', 'Range'], ['WBC', 5, '2025-03-04', { date: '2026-01-05T00:00' }], [null, 6, '2025-03-04', null], ['RBC', 4.5, 'soon', null]] },
        { name: 'Notes', rows: [['Remember to fast']] },
        { name: 'History', rows: [['Test', 'Range', 'Units', '4 Mar 2024', 'Trend'], ['TSH', '0.4-4.0', 'mIU/L', 2.1, 'flat']] },
      ],
      'xlsx',
    )
    const said = d.document_warnings.join('\n')
    expect(said).toMatch(/1 row\(s\) in "CBC" had no readable date/)
    expect(said).toMatch(/1 row\(s\) in "CBC" had a value but no test name/)
    expect(said).toMatch(/1 reference range\(s\) in "CBC" hold a date/)
    expect(said).toMatch(/Left out, because the columns were not recognised: "Notes"/)
    expect(said).toMatch(/not read as dates and were left out: "Trend"/)
    expect(d.panels.map((p) => [p.draw_date, p.results.map((r) => [r.raw_name, r.reference_text])])).toEqual([
      ['2024-03-04', [['TSH', '0.4-4.0']]],
      ['2025-03-04', [['WBC', null]]],
    ])
  })
  it('warns once when values use a decimal comma', () => {
    expect(doc('Test;Value;Date\nA;3,8;2025-03-04\nB;1,500;2025-03-04\n').document_warnings.filter((w) => w.includes('decimals with a comma'))).toHaveLength(1)
    expect(doc('Test,Value,Date\nA,"1,500",2025-03-04\n').document_warnings).toEqual([])
  })
})

describe('PDF text', () => {
  const item = (str: string, x: number, width: number, y = 100) => ({ str, x, y, width, fontSize: 10 })
  it('joins pieces of one number and keeps repeats that are separate items', () => {
    expect(layoutPage([item('13', 100, 11), item('.5', 111, 8)])).toContain('13.5')
    expect(layoutPage([item('9', 100, 5.5), item('9', 105.5, 5.5)]).trim()).toBe('99')
    expect(layoutPage([item('Negative', 100, 40), item('Negative', 200, 40)]).match(/Negative/g)).toHaveLength(2)
  })
  it('drops text drawn twice in one place to fake bold', () => {
    expect(layoutPage([item('Glucose', 100, 35), item('Glucose', 100.3, 35)]).trim()).toBe('Glucose')
  })
  it('keeps a collection-date heading with the results under it when a page is split', () => {
    const block = (date: string, n: number) => [`Collected: ${date}`, '', ...Array.from({ length: n }, (_, i) => `Test ${i} value ${i}.5 range 1 - 10`)].join('\n')
    const pieces = splitText([block('01/05/2024', 6), block('02/05/2024', 6), block('03/05/2024', 6)].join('\n\n'), 260)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) expect(piece.trim().split('\n').at(-1)).not.toMatch(/^Collected:/)
  })
})
