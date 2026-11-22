// Lab value / reference-range parsing. One set of rules for tabular imports,
// extraction review and commits.

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

const NUM = '(-?\\d+(?:\\.\\d+)?)'

export function parseLabValue(raw: string): ParsedValue {
  const value = raw
    .trim()
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/^<\s*OR\s*=/i, '<=')
    .replace(/^>\s*OR\s*=/i, '>=')
  const match = value.match(new RegExp(`^(<=|>=|<|>|=)?\\s*${NUM}\\s*(HH|LL|H|L|\\*)?$`, 'i'))
  if (!match) return { comparator: 'text', numeric: null, text: raw.trim() }
  const glyph = match[3]?.toUpperCase()
  const flag: LabFlag | null = !glyph ? null : glyph === 'HH' || glyph === 'LL' ? 'critical' : glyph === 'H' ? 'high' : glyph === 'L' ? 'low' : 'abnormal'
  return { comparator: (match[1] as Comparator | undefined) ?? '=', numeric: Number(match[2]), text: null, flag }
}

export function normalizeReferenceText(value: string | null | undefined): string | null {
  if (!value) return null
  let normalized = value.trim().replace(/[–—]/g, '-')
  normalized = normalized
    .replace(/>\s*\/\s*=|>\s*OR\s*=/gi, '>=')
    .replace(/<\s*\/\s*=|<\s*OR\s*=/gi, '<=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
  normalized = normalized.replace(/\s+/g, ' ')
  if (!normalized) return null
  // Excel serial dates that leaked into a reference column.
  if (/^\d{5}(?:\.0+)?$/.test(normalized)) return null
  return normalized
}

export function parseReferenceRange(text: string | null | undefined): ParsedReference | null {
  const raw = normalizeReferenceText(text)
  if (!raw) return null
  let m = raw.match(new RegExp(`^(<=|>=|<|>)\\s*${NUM}`))
  if (m) return comparatorBand(raw, m[1], Number(m[2]))
  m = raw.match(new RegExp(`^(?:less than|below|under|up to)\\s*${NUM}`, 'i'))
  if (m) return comparatorBand(raw, '<', Number(m[1]))
  m = raw.match(new RegExp(`^(?:greater than|above|over|at least)\\s*${NUM}`, 'i'))
  if (m) return comparatorBand(raw, '>', Number(m[1]))
  m = raw.match(new RegExp(`^${NUM}(?:\\s+\\S+)?\\s+or\\s+(?:below|less|lower)$`, 'i'))
  if (m) return comparatorBand(raw, '<=', Number(m[1]))
  m = raw.match(new RegExp(`^${NUM}(?:\\s+\\S+)?\\s+or\\s+(?:above|greater|higher)$`, 'i'))
  if (m) return comparatorBand(raw, '>=', Number(m[1]))
  m = raw.match(new RegExp(`${NUM}\\s*(?:-|to)\\s*${NUM}`, 'i'))
  if (m) {
    let low = Number(m[1])
    let high = Number(m[2])
    if (low > high) [low, high] = [high, low]
    return { raw, low, high }
  }
  return { raw, low: null, high: null }
}

function comparatorBand(raw: string, comparator: string, limit: number): ParsedReference {
  const strict = comparator === '<' || comparator === '>'
  return comparator.startsWith('<') ? { raw, low: null, high: limit, strict } : { raw, low: limit, high: null, strict }
}

/** Flag inferred from the reported reference text. Never from catalog defaults. */
export function inferFlag(value: number | null, ref: ParsedReference | null): LabFlag | null {
  if (value == null || !ref) return null
  if (ref.low != null && (value < ref.low || (ref.strict && value === ref.low))) return 'low'
  if (ref.high != null && (value > ref.high || (ref.strict && value === ref.high))) return 'high'
  return null
}

export function normalizeFlag(value: string | null | undefined): LabFlag | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (!v || v === 'normal' || v === 'n' || v === 'in range') return null
  if (v.startsWith('crit') || v === 'hh' || v === 'll' || v.includes('panic')) return 'critical'
  if (v === 'l' || v.startsWith('lo')) return 'low'
  if (v === 'h' || v.startsWith('hi')) return 'high'
  return 'abnormal'
}

export type RangeStatus = 'low' | 'high' | 'in' | 'unknown'

/** Position relative to the reference band, honoring a reported flag first. */
export function rangeStatus(
  value: number | null,
  refLow: number | null,
  refHigh: number | null,
  flag: string | null,
): RangeStatus {
  if (flag) {
    const f = flag.toLowerCase()
    if (f.includes('low')) return 'low'
    if (f.includes('high')) return 'high'
    if (value != null && refLow != null && value < refLow) return 'low'
    return 'high'
  }
  if (value == null || (refLow == null && refHigh == null)) return 'unknown'
  if (refLow != null && value < refLow) return 'low'
  if (refHigh != null && value > refHigh) return 'high'
  return 'in'
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

/** Numeric/derived columns for a result, computed from what was displayed. */
export function deriveResultFields(rawValue: string, referenceText: string | null | undefined, reportedFlag: string | null | undefined): DerivedResultFields {
  const value = parseLabValue(rawValue)
  const ref = parseReferenceRange(referenceText)
  const reported = normalizeFlag(reportedFlag) ?? value.flag ?? null
  // Censored values (<x, >x) only get an inferred flag when the bound itself is outside the range.
  const inferred = reported ? null : value.comparator === '=' ? inferFlag(value.numeric, ref) : censoredFlag(value, ref)
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

function censoredFlag(value: ParsedValue, ref: ParsedReference | null): LabFlag | null {
  if (value.numeric == null || !ref) return null
  if ((value.comparator === '<' || value.comparator === '<=') && ref.low != null && value.numeric <= ref.low) return 'low'
  if ((value.comparator === '>' || value.comparator === '>=') && ref.high != null && value.numeric >= ref.high) return 'high'
  return null
}

/** Same reported result? Text-equal, or the same comparator and number ("117" vs "117.0"). */
export function sameReportedValue(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true
  const x = parseLabValue(a)
  const y = parseLabValue(b)
  return x.numeric != null && y.numeric != null && x.comparator === y.comparator && x.numeric === y.numeric
}
