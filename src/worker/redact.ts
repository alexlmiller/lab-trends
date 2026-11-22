// Deterministic identifier redaction before document text leaves the Worker
// for an extraction model. Patterns, not a guarantee: a name printed without a
// label, or anything in a photo, still reaches the model.
//
// Every quantifier here is bounded and every pattern is tried against lines of
// at most MAX_LINE characters, so the time spent grows with the length of the
// text and never with its square (test/redact.test.ts times this).

const MAX_LINE = 2_000
const GAP = '[ \\t]{0,3}'
const ID = '(?=[A-Z0-9-]{0,29}\\d)[A-Z0-9-]{4,30}'
const DATE = '(?:\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2}|[A-Za-z]{3,9}\\.? \\d{1,2},? \\d{4}|\\d{1,2} [A-Za-z]{3,9}\\.? \\d{4})'
const CITY = "[A-Z][A-Za-z .'-]{1,30},[ \\t]?[A-Z]{2}[ \\t]{1,2}\\d{5}(?:-\\d{4})?"
// "Test Name: Glucose" and "Physician Name: …" are not the patient.
const NOT_A_PERSON = '(?<!\\b(?:Test|Component|Analyte|Panel|Order|Lab|Laboratory|Facility|Provider|Physician|Doctor|Drug|Product|File)[ \\t])'

const PATTERNS: [string, RegExp][] = [
  ['name', new RegExp(`\\b(?:Patient${GAP}Name|Legal Name|${NOT_A_PERSON}Name|Patient)${GAP}:${GAP}[^|\\n\\f]{1,80}`, 'gi')],
  ['name', new RegExp(`^[ \\t]{0,40}(?:Patient[ \\t]{1,3}Name|Patient|Name)${GAP}:?${GAP}[A-Z][A-Z ,.'-]{2,80}$`, 'gm')],
  ['dob', new RegExp(`\\b(?:DOB|D\\.O\\.B\\.?|Date of Birth|Birth ?date|Born)${GAP}:?${GAP}${DATE}`, 'gi')],
  ['mrn', new RegExp(`\\b(?:MRN|Medical Record (?:Number|No\\.?|#)|Patient (?:ID|No\\.?|#)|Account(?: Number| No\\.?| #)?|Acct\\.?(?: No\\.?| #)?|Chart (?:Number|No\\.?|#))${GAP}[:#]?${GAP}${ID}\\b`, 'gi')],
  ['address', new RegExp(`\\b(?:Address|Addr\\.?)${GAP}:${GAP}[^|\\n\\f]{1,120}`, 'gi')],
  // A street line is only recognised by the city, state and ZIP line under it; on its own it reads like any other text.
  ['address', new RegExp(`^[ \\t]{0,40}\\d{1,6} [^\\n|]{3,60}\\n[ \\t]{0,40}${CITY}`, 'gm')],
  ['address', new RegExp(`\\b${CITY}\\b`, 'g')],
  ['phone', new RegExp(`\\b(?:Phone|Tel|Telephone|Mobile|Fax)${GAP}[:#]${GAP}\\+?[\\d() .-]{7,20}`, 'gi')],
  ['phone', /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g],
  ['email', /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,24}\b/gi],
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g],
]

/** The text with every match replaced by a numbered placeholder such as [REDACTED_NAME_1]. */
export function redact(input: string): string {
  // A line longer than any report prints is broken up, which bounds what one pattern can be made to scan.
  const text = input.replace(new RegExp(`[^\\n]{${MAX_LINE}}`, 'g'), '$&\n')
  const matches: { start: number; end: number; label: string }[] = []
  for (const [label, re] of PATTERNS) {
    for (const m of text.matchAll(re)) matches.push({ start: m.index!, end: m.index! + m[0].length, label })
  }
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  let out = ''
  let cursor = 0
  const counts: Record<string, number> = {}
  for (const m of matches) {
    if (m.start < cursor) continue
    counts[m.label] = (counts[m.label] ?? 0) + 1
    out += text.slice(cursor, m.start) + `[REDACTED_${m.label.toUpperCase()}_${counts[m.label]}]`
    cursor = m.end
  }
  return out + text.slice(cursor)
}
