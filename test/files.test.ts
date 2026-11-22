// Uploaded files: the spreadsheet reader, its size limits, and what is taken
// out of report text before a model sees it.
import { describe, expect, it } from 'vitest'
import { sheetsToDocument } from '../src/shared/tabular'
import { readXlsx } from '../src/shared/xlsx'
import { contentTypeFor, servedType, sourceKindFor } from '../src/worker/lib'
import { redact } from '../src/worker/redact'
import { workbook, zip } from './helpers'

const cell = (ref: string, value: string | number, attrs = '') => `<c r="${ref}"${attrs}><v>${value}</v></c>`
const text = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
const header = `<row r="1">${text('A1', 'Test')}${text('B1', 'Value')}${text('C1', 'Date')}</row>`

describe('xlsx', () => {
  it('reads numbers, inline and shared strings, and dates', async () => {
    const styles = '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'
    const shared = '<sst><si><t>Glucose</t></si><si/><si><r><t/></r><r><t>Sodium</t></r></si><si><t>&lt;5 &amp; &#x41;</t></si></sst>'
    const rows = `${header}<row r="2"><c r="A2" t="s"><v>0</v></c>${cell('B2', 90)}${cell('C2', 45720, ' s="1"')}</row><row r="3"/><row r="4"><c r="A4" t="s"><v>2</v></c><c r="B4" t="s"><v>3</v></c>${cell('C4', 45721, ' s="1"')}</row>`
    const [sheet] = await readXlsx(workbook(rows, { styles, sharedStrings: shared }))
    expect(sheet.name).toBe('Labs')
    // An empty <si/> still takes an index, and an empty <t/> run does not leak markup into the next one.
    expect(sheet.rows).toEqual([['Test', 'Value', 'Date'], ['Glucose', 90, { date: '2025-03-04T00:00' }], [], ['Sodium', '<5 & A', { date: '2025-03-05T00:00' }]])
  })

  it('shows a percent cell as the percent the sheet shows, and an error cell as empty', async () => {
    const styles = '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="9"/></cellXfs></styleSheet>'
    const rows = `${header}<row r="2">${text('A2', 'Hematocrit')}${cell('B2', 0.45, ' s="1"')}${text('C2', '2025-03-04')}</row><row r="3">${text('A3', 'Ratio')}<c r="B3" t="e"><v>#N/A</v></c>${text('C3', '2025-03-04')}</row>`
    const [sheet] = await readXlsx(workbook(rows, { styles }))
    expect(sheet.rows[1][1]).toBe('45%')
    expect(sheet.rows[2][1]).toBeNull()
    expect(sheetsToDocument([sheet], 'xlsx').panels[0].results.map((r) => r.raw_value)).toEqual(['45%'])
  })

  it('keeps a small number a number even when its cell carries a date format', async () => {
    const styles = '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'
    const [sheet] = await readXlsx(workbook(`${header}<row r="2">${text('A2', 'TSH')}${cell('B2', 4.5, ' s="1"')}${text('C2', '2025-03-04')}</row>`, { styles }))
    expect(sheet.rows[1][1]).toBe(4.5)
  })

  it('counts dates from 1904 in a workbook saved that way', async () => {
    const styles = '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'
    const rows = `${header}<row r="2">${text('A2', 'Glucose')}${cell('B2', 90)}${cell('C2', 44258, ' s="1"')}</row>`
    const [sheet] = await readXlsx(workbook(rows, { styles, workbookPr: '<workbookPr date1904="1"/>' }))
    expect(sheet.rows[1][2]).toEqual({ date: '2025-03-04T00:00' })
  })

  it('refuses a sheet that claims rows, columns or bytes beyond what it will hold', async () => {
    const tooLarge = /too large/
    await expect(readXlsx(workbook(`<row r="4000000000">${cell('A4000000000', 1)}</row>`))).rejects.toThrow(tooLarge)
    await expect(readXlsx(workbook(`<row r="1">${cell('XFD1', 1)}</row>`))).rejects.toThrow(tooLarge)
    // A part that inflates past the limit is stopped while it inflates, whatever size its header claims.
    const bomb = workbook('<row r="1">' + '<c r="A1"><v>1</v></c>'.repeat(700_000) + '</row>')
    await expect(readXlsx(bomb)).rejects.toThrow(tooLarge)
    const lying = zip({ 'xl/workbook.xml': '<workbook>' + ' '.repeat(13 * 1024 * 1024) + '</workbook>' }, { claimSize: 100 })
    await expect(readXlsx(lying)).rejects.toThrow(tooLarge)
  })

  it('says so when the file is not a workbook', async () => {
    await expect(readXlsx(new TextEncoder().encode('Test,Value,Date\n'))).rejects.toThrow(/not a ZIP archive/)
    await expect(readXlsx(zip({ 'readme.txt': 'hello' }))).rejects.toThrow(/not an Excel workbook/)
  })
})

describe('content types', () => {
  it('stores and serves an upload as one of a fixed list of types, whatever the uploader claimed', () => {
    expect(sourceKindFor('report.pdf', 'text/html')).toBe('pdf')
    expect(contentTypeFor('report.pdf')).toBe('application/pdf')
    expect(contentTypeFor('photo.JPG')).toBe('image/jpeg')
    expect(contentTypeFor('page.html')).toBe('application/octet-stream')
    expect(servedType('report.pdf', 'text/html')).toBe('application/pdf')
    expect(servedType('scan', 'application/pdf')).toBe('application/pdf')
    expect(servedType('page.html', 'text/html')).toBe('application/octet-stream')
  })
})

describe('redaction', () => {
  it('removes identifiers where a report labels them', () => {
    const page = [
      'Patient: DOE, JANE Q            DOB: 03/14/1975',
      'Patient Name: Jane Doe | MRN: A1234567',
      'Date of Birth: March 14, 1975     Account Number: 99-1234',
      'Address: 12 Example Lane',
      '1200 Example Street',
      'Springfield, OR 97477',
      'Phone: 5415550100   jane.doe@example.com   (541) 555-0100',
    ].join('\n')
    const out = redact(page)
    for (const secret of ['JANE', 'Jane', '1975', 'A1234567', '99-1234', 'Example Lane', '1200 Example Street', 'Springfield', '97477', '5415550100', 'example.com', '555-0100']) {
      expect(out, secret).not.toContain(secret)
    }
    expect(out).toContain('[REDACTED_NAME_1]')
    expect(out).toContain('[REDACTED_DOB_1]')
  })

  it('leaves the report itself alone', () => {
    const page = [
      'Test Name: Glucose          Physician Name: A. Example',
      'Collected: 03/04/2024 08:15 by Dr Example',
      'Glucose          90      70 - 99 mg/dL',
      'Red Cell Count   4.50    4.20 - 5.90',
      'Accession: QX-20240304-001',
    ].join('\n')
    expect(redact(page)).toBe(page)
  })

  it('takes time in proportion to the text, however the text is shaped', () => {
    const shapes: ((n: number) => string)[] = [(n) => 'a.'.repeat(n / 2), (n) => '\n'.repeat(n), (n) => 'Patient' + ' '.repeat(n) + '1', (n) => ' '.repeat(n), (n) => 'Name: ' + 'A '.repeat(n / 2) + '1', (n) => '1'.repeat(n)]
    for (const shape of shapes) {
      const started = performance.now()
      redact(shape(200_000))
      // Before the patterns were bounded, 80,000 characters of the first three shapes took ten seconds each.
      expect(performance.now() - started).toBeLessThan(1_500)
    }
  })
})
