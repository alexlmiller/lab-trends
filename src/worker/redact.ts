// Deterministic identifier redaction before document text leaves the Worker
// for an extraction model. Patterns, not a guarantee: a name printed without a
// label, or anything in a photo, still reaches the model.

const PATTERNS: [string, RegExp][] = [
  ['name', /\b(?:Patient\s+Name|Legal Name|Name)\s*:\s*[^|\n\f]+/gi],
  ['name', /^\s*(?:Patient\s+Name|Patient|Name)\s*:?\s*[A-Z][A-Z ,.'-]{2,}$/gm],
  ['dob', /\b(?:DOB|Date of Birth)\s*:?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi],
  ['mrn', /\b(?:MRN|Medical Record Number)\s*:?\s*[A-Z0-9-]{4,}\b/gi],
  ['phone', /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g],
]

export function redact(text: string): { text: string; count: number } {
  const matches: { start: number; end: number; label: string }[] = []
  for (const [label, re] of PATTERNS) {
    for (const m of text.matchAll(re)) matches.push({ start: m.index!, end: m.index! + m[0].length, label })
  }
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  let out = ''
  let cursor = 0
  let count = 0
  const counts: Record<string, number> = {}
  for (const m of matches) {
    if (m.start < cursor) continue
    counts[m.label] = (counts[m.label] ?? 0) + 1
    out += text.slice(cursor, m.start) + `[REDACTED_${m.label.toUpperCase()}_${counts[m.label]}]`
    cursor = m.end
    count++
  }
  return { text: out + text.slice(cursor), count }
}
