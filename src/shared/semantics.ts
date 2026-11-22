// Lab value, reference-range and flag parsing. One set of rules for tabular
// imports, extraction review, commits and every screen that shows a status.
//
// The rule throughout: derive a number, a band or a flag only when the whole
// text is understood. Anything else is kept as text and derives nothing, so a
// misread shows up as "not read" and never as a wrong number.

export type Comparator = '=' | '<' | '<=' | '>' | '>=' | 'text'

export type ParsedValue = {
  comparator: Comparator
  numeric: number | null
  text: string | null
  /** Flag glyph printed next to the value ("12.1 H"), if any. */
  flag?: LabFlag | null
}

export type ParsedReference = {
  raw: string
  low: number | null
  high: number | null
  /** "<5.0" excludes 5.0 itself; "<=5.0" and "0-5.0" include it. */
  strict?: boolean
}

export type LabFlag = 'low' | 'high' | 'critical' | 'abnormal'

// A number as reports print it: 1500, 1,500, 150 000, 3.8, 3,8, .5, 1.5E3.
const INT = '(?:\\d{1,3}(?:,\\d{3})+|\\d{1,3}(?: \\d{3})+|\\d+)'
const NUM = `(-?(?:${INT}(?:[.,]\\d+)?|[.,]\\d+)(?:e[-+]?\\d+)?)`

/**
 * The value of one number token, or null when its marks are ambiguous.
 * "1,500" is fifteen hundred; "0,500", "3,8" and "12,75" use a decimal comma.
 */
export function toNumber(token: string): number | null {
  const m = token.trim().match(/^(-?)([\d., ]+?)(e[-+]?\d+)?$/i)
  if (!m || !/\d/.test(m[2])) return null
  let body = m[2].replace(/ /g, '')
  const commas = body.split(',').length - 1
  const dots = body.split('.').length - 1
  if (commas && dots) {
    // The later mark is the decimal mark; the other one groups digits.
    const decimal = body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.'
    if (body.split(decimal).length !== 2) return null
    body = body.split(decimal === ',' ? '.' : ',').join('').replace(decimal, '.')
  } else if (commas) {
    if (/^[1-9]\d{0,2}(?:,\d{3})+$/.test(body)) body = body.replace(/,/g, '')
    else if (commas === 1) body = body.replace(',', '.')
    else return null
  } else if (dots > 1) return null
  const n = Number(m[1] + body + (m[3] ?? ''))
  return Number.isFinite(n) ? n : null
}

/** True for a value written with a decimal comma ("3,8", "0,500"), which makes "1,500" in the same file ambiguous. */
export function usesDecimalComma(raw: string): boolean {
  const token = normalizeMarks(raw).match(new RegExp(`^(?:<=|>=|<|>|=)?\\s*${NUM}`, 'i'))?.[1]
  if (!token || !token.includes(',') || token.includes('.')) return false
  return !/^-?[1-9]\d{0,2}(?:,\d{3})+(?:e|$)/i.test(token)
}

/** Shown on a file whose values use a decimal comma. */
export const DECIMAL_COMMA_NOTE =
  'This file writes decimals with a comma (3,8). A value such as 1,500 is read as 1500, so check any value with exactly three digits after the comma.'

/** One spelling for the marks reports vary: minus signs, ≤ ≥, "=<", "> OR =", runs of spaces. */
function normalizeMarks(value: string): string {
  return value
    .replace(/−/g, '-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/<\s*(?:\/|or)?\s*=|=\s*</gi, '<=')
    .replace(/>\s*(?:\/|or)?\s*=|=\s*>/gi, '>=')
    .replace(/\s+/g, ' ')
    .trim()
}

const GLYPHS: Record<string, LabFlag> = { hh: 'critical', ll: 'critical', h: 'high', l: 'low', high: 'high', low: 'low', a: 'abnormal', '*': 'abnormal' }
// "12.1", "<0.5", "12.1 H", "7.1 (H)", "5.2 High", "102*", "45%".
const VALUE = new RegExp(`^(<=|>=|<|>|=)?\\s*${NUM}\\s*%?\\s*(?:[(\\[]\\s*(hh|ll|h|l|a|\\*)\\s*[)\\]]|(hh|ll|h|l|\\*|high|low))?$`, 'i')

export function parseLabValue(raw: string): ParsedValue {
  const m = normalizeMarks(raw).match(VALUE)
  const numeric = m ? toNumber(m[2]) : null
  if (!m || numeric == null) return { comparator: 'text', numeric: null, text: raw.trim() }
  const glyph = (m[3] ?? m[4])?.toLowerCase()
  return { comparator: (m[1] as Comparator | undefined) ?? '=', numeric, text: null, flag: glyph ? GLYPHS[glyph] : null }
}

export function normalizeReferenceText(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = normalizeMarks(value.replace(/[–—]/g, '-'))
  if (!normalized) return null
  // A spreadsheet turns a range such as "1-5" into a date; neither form of it is a range.
  if (/^\d{5}(?:\.0+)?$/.test(normalized) || /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(normalized)) return null
  return normalized
}

// Numbers that belong to a unit, not to the range: x10E3/uL, 10^9/L, /1.73m2, /100 WBC.
const UNIT_NUMBERS = /[x×]\s*10\s*e\s*-?\d+|(?:[x×]\s*)?10\s*(?:\^|\*{1,2})\s*-?\d+|\/\s*1\.73(?:\s*m\S*)?|\/\s*\d+(?:\.\d+)?\s*[a-zµμ]+/gi
const LABEL = '(?:[a-z][a-z .()/]*?[:=]?\\s*)?'
const UNIT = '(?:\\s*[^\\d\\s<>-]+)?'
const TWO_SIDED = new RegExp(`^${LABEL}(>=|>)\\s*${NUM}${UNIT}\\s*(?:and|&|,|;)?\\s*(<=|<)\\s*${NUM}([^<>]*)$`, 'i')
const ONE_SIDED = new RegExp(`^${LABEL}(<=|>=|<|>)\\s*${NUM}([^<>]*)$`, 'i')
const BETWEEN = new RegExp(`^${LABEL}${NUM}${UNIT}\\s*(?:-|to)\\s*${NUM}([^<>]*)$`, 'i')
const OR_WORD = new RegExp(`^${LABEL}${NUM}${UNIT}\\s+or\\s+(below|less|lower|under|above|greater|higher|more|over)\\.?$`, 'i')

/**
 * The band a reference text states. Only a text that is one range, with an
 * optional label and unit, gives a band: "18-49 years: 2.0-7.0", a male and a
 * female range, or risk tiers keep their text and give none.
 */
export function parseReferenceRange(text: string | null | undefined): ParsedReference | null {
  const raw = normalizeReferenceText(text)
  if (!raw) return null
  const none: ParsedReference = { raw, low: null, high: null }
  // Anything this long is a comment, not a range.
  if (raw.length > 120) return none
  const s = raw
    .replace(UNIT_NUMBERS, ' ')
    .replace(/\b(?:less than or equal to|no more than|at most|up to)\s*(?=[-.,\d])/gi, '<=')
    .replace(/\b(?:greater than or equal to|no less than|at least)\s*(?=[-.,\d])/gi, '>=')
    .replace(/\b(?:less than|below|under)\s*(?=[-.,\d])/gi, '<')
    .replace(/\b(?:greater than|more than|above|over)\s*(?=[-.,\d])/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()

  let m = s.match(TWO_SIDED)
  if (m) {
    const low = toNumber(m[2])
    const high = toNumber(m[4])
    if (low == null || high == null || low > high || hasFreeNumber(m[5])) return none
    return { raw, low, high, strict: m[1] === '>' && m[3] === '<' }
  }
  m = s.match(ONE_SIDED)
  if (m) {
    const limit = toNumber(m[2])
    if (limit == null || hasFreeNumber(m[3])) return none
    return comparatorBand(raw, m[1], limit)
  }
  m = s.match(BETWEEN)
  if (m) {
    const low = toNumber(m[1])
    const high = toNumber(m[2])
    // A low end above the high end means the text was not understood; never swap them.
    if (low == null || high == null || low > high || hasFreeNumber(m[3])) return none
    return { raw, low, high }
  }
  m = s.match(OR_WORD)
  if (m) {
    const limit = toNumber(m[1])
    if (limit == null) return none
    return comparatorBand(raw, /below|less|lower|under/i.test(m[2]) ? '<=' : '>=', limit)
  }
  return none
}

/** A digit that is not part of a unit such as mm3 or m2: a second number, so the text is more than one range. */
function hasFreeNumber(text: string): boolean {
  let attached = false
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      if (!attached) return true
    } else attached = /[a-zµμ]/i.test(ch)
  }
  return false
}

function comparatorBand(raw: string, comparator: string, limit: number): ParsedReference {
  const strict = comparator === '<' || comparator === '>'
  return comparator.startsWith('<') ? { raw, low: null, high: limit, strict } : { raw, low: limit, high: null, strict }
}

/**
 * The flag a reported word or glyph stands for. Words this does not know mean
 * no flag: a column of "No", "Final" or "N/A" must not mark results abnormal.
 */
export function normalizeFlag(value: string | null | undefined): LabFlag | null {
  if (!value) return null
  const v = value.trim().toLowerCase().replace(/^[([]\s*|\s*[)\]]$/g, '')
  if (/\b(?:normal|not|no|non|none|within|wnl)\b/.test(v)) return null
  if (/^(?:hh|ll)\b/.test(v) || /\b(?:crit|critical|panic|alert)\b/.test(v)) return 'critical'
  if (/^(?:l|lo)\*?$/.test(v) || /\b(?:low|below)\b/.test(v) || /^[↓▼]/.test(v)) return 'low'
  if (/^(?:h|hi)\*?$/.test(v) || /\b(?:high|above|elevated)\b/.test(v) || /^[↑▲]/.test(v)) return 'high'
  if (/^(?:a|yes|y|true|\*+|!+)$/.test(v) || /\b(?:abn|abnormal|flag|flagged|out of range)\b/.test(v)) return 'abnormal'
  return null
}

type Placeable = {
  value_numeric: number | null
  comparator?: string | null
  ref_low: number | null
  ref_high: number | null
  reference_text?: string | null
}

/**
 * Where a value sits against its own reported band, or undefined when it
 * cannot be placed. A censored reading ("<0.3") is placed only if every value
 * it allows is on the same side.
 */
export function relativeToReference(r: Placeable): 'low' | 'high' | 'in' | undefined {
  const { value_numeric: value, ref_low: low, ref_high: high } = r
  if (value == null || (low == null && high == null) || (low != null && high != null && low > high)) return undefined
  // Only a value sitting exactly on a limit needs to know whether the limit itself is excluded.
  const strict = (value === low || value === high) && parseReferenceRange(r.reference_text)?.strict === true
  return place(value, r.comparator ?? '=', low, high, strict)
}

function place(value: number, comparator: string, low: number | null, high: number | null, strict: boolean): 'low' | 'high' | 'in' | undefined {
  const exact = comparator === '='
  const under = comparator === '<' || comparator === '<='
  const over = comparator === '>' || comparator === '>='
  if (!exact && !under && !over) return undefined
  if (low != null && (exact || under) && (value < low || (value === low && (strict || comparator === '<')))) return 'low'
  if (high != null && (exact || over) && (value > high || (value === high && (strict || comparator === '>')))) return 'high'
  if (exact) return 'in'
  // "<0.3" against "<3.0": nothing it allows is out of range.
  if (under && low == null && high != null && (value < high || (value === high && !strict))) return 'in'
  if (over && high == null && low != null && (value > low || (value === low && !strict))) return 'in'
  return undefined
}

/** "flagged": the lab marked the result, and neither the mark nor the range says in which direction. */
export type RangeStatus = 'low' | 'high' | 'in' | 'flagged' | 'unknown'

type Flagged = Placeable & { lab_flag?: string | null }

/** The one rule for a result's status: the reported direction first, then its position in its own band. */
export function resultStatus(r: Flagged | null | undefined): RangeStatus {
  if (!r) return 'unknown'
  if (r.lab_flag === 'low' || r.lab_flag === 'high') return r.lab_flag
  const position = relativeToReference(r)
  if (r.lab_flag) return position === 'low' || position === 'high' ? position : 'flagged'
  return position ?? 'unknown'
}

/** The colour family a status is drawn in. A flagged result takes the high tone: it needs the same attention. */
export function statusTone(status: RangeStatus): 'low' | 'high' | null {
  return status === 'low' ? 'low' : status === 'high' || status === 'flagged' ? 'high' : null
}

export function isOutOfRange(r: Flagged): boolean {
  return statusTone(resultStatus(r)) !== null
}

/**
 * Where a value sits in its reference band: 0 = low edge, 1 = high edge.
 * One-sided bands use the limit as the 1 (or 0) anchor and 0 as the floor.
 */
export function positionInRange(value: number, low: number | null, high: number | null): number | null {
  if (low != null && high != null && high > low) return (value - low) / (high - low)
  if (high != null && low == null && high > 0) return value / high
  if (low != null && high == null && low > 0) return value / low - 1
  return null
}

export type DerivedResultFields = {
  comparator: Comparator
  value_numeric: number | null
  value_text: string | null
  reference_text: string | null
  ref_low: number | null
  ref_high: number | null
  lab_flag: LabFlag | null
  flag_source: 'reported' | 'inferred' | null
}

/** Numeric and derived columns for a result, computed from what was displayed. A flag never comes from catalog defaults. */
export function deriveResultFields(rawValue: string, referenceText: string | null | undefined, reportedFlag: string | null | undefined): DerivedResultFields {
  const value = parseLabValue(rawValue)
  const ref = parseReferenceRange(referenceText)
  const reported = normalizeFlag(reportedFlag) ?? value.flag ?? null
  const position = reported || !ref || value.numeric == null ? undefined : place(value.numeric, value.comparator, ref.low, ref.high, ref.strict === true)
  const inferred = position === 'low' || position === 'high' ? position : null
  return {
    comparator: value.comparator,
    value_numeric: value.numeric,
    value_text: value.text,
    reference_text: ref?.raw ?? null,
    ref_low: ref?.low ?? null,
    ref_high: ref?.high ?? null,
    lab_flag: reported ?? inferred,
    flag_source: reported ? 'reported' : inferred ? 'inferred' : null,
  }
}

/** Same reported result? Text-equal, or the same comparator and number ("117" vs "117.0"). */
export function sameReportedValue(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true
  const x = parseLabValue(a)
  const y = parseLabValue(b)
  return x.numeric != null && y.numeric != null && x.comparator === y.comparator && x.numeric === y.numeric
}
