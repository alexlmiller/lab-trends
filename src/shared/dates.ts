// Draw dates are calendar dates (YYYY-MM-DD), never instants. Doing math on
// day numbers keeps a midnight draw from rendering as the previous day in
// western time zones.

const MS_DAY = 86_400_000

export function dayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / MS_DAY)
}

export function dateFromDay(day: number): string {
  return new Date(day * MS_DAY).toISOString().slice(0, 10)
}

export function todayDate(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

/** A real calendar date written YYYY-MM-DD: no month 13, no 30 February. */
export function isValidDate(date: string | null | undefined): date is string {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return y >= 1900 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export function formatDate(date: string | null | undefined, style: 'long' | 'short' | 'month' = 'long'): string {
  if (!date) return '—'
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const month = MONTHS[m - 1]
  if (!y || !month) return date
  if (style === 'month') return `${month} '${String(y).slice(-2)}`
  if (style === 'short') return `${month} ${d}`
  return `${month} ${d}, ${y}`
}

export type LooseDate = { date: string; time: string | null }

/**
 * Parse a date as documents and sheets write it into YYYY-MM-DD (+ optional HH:MM).
 * Anything that is not a real date gives null. A slash date is month first
 * unless its own numbers say otherwise (13/04/2025) or `dayFirst` is set.
 */
export function parseLooseDate(value: string | null | undefined, options: { dayFirst?: boolean } = {}): LooseDate | null {
  if (!value) return null
  const v = value.trim()
  // 2025-03-04, 2025-03-04T08:15:00+00:00, 2025-03-04 8:15 PM
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([AP]M)?)?/i)
  if (m) return build(+m[1], +m[2], +m[3], clock(m[4], m[5], m[6]))
  // 20250304
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return build(+m[1], +m[2], +m[3], null)
  // 3/4/2025 08:15 AM
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?)?/i)
  if (m) {
    const [a, b] = [+m[1], +m[2]]
    const dayFirst = a > 12 && b <= 12 ? true : b > 12 ? false : options.dayFirst === true
    return build(fullYear(m[3]), dayFirst ? b : a, dayFirst ? a : b, clock(m[4], m[5], m[6]))
  }
  // 04.03.2025: dotted dates are written day first
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/)
  if (m) return build(fullYear(m[3]), +m[2], +m[1], null)
  // Apr-26, April 2026: a whole month, kept as its first day
  m = v.match(/^([A-Za-z]{3,9})\.?[-\s]+(\d{4}|\d{2})$/)
  if (m && monthOf(m[1])) return build(fullYear(m[2]), monthOf(m[1]), 1, null)
  // Mar 4, 2025
  m = v.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/)
  if (m && monthOf(m[1])) return build(+m[3], monthOf(m[1]), +m[2], null)
  // 4 Mar 2025, 04-Mar-25
  m = v.match(/^(\d{1,2})(?:st|nd|rd|th)?[-\s]+([A-Za-z]{3,9})\.?,?[-\s]+(\d{4}|\d{2})$/)
  if (m && monthOf(m[2])) return build(fullYear(m[3]), monthOf(m[2]), +m[1], null)
  return null
}

/**
 * What a set of slash dates says about its own order. "day" or "month" when
 * one of them has a part above 12, "unclear" when none does, "mixed" when
 * they disagree, null when there are no slash dates.
 */
export function slashDateOrder(values: Iterable<string>): 'day' | 'month' | 'unclear' | 'mixed' | null {
  let day = 0
  let month = 0
  let unclear = 0
  for (const value of values) {
    const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(?:\d{4}|\d{2})\b/)
    if (!m) continue
    if (+m[1] > 12 && +m[2] <= 12) day++
    else if (+m[2] > 12 && +m[1] <= 12) month++
    else unclear++
  }
  if (day && month) return 'mixed'
  return day ? 'day' : month ? 'month' : unclear ? 'unclear' : null
}

function build(y: number, m: number, d: number, time: string | null): LooseDate | null {
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isValidDate(date) ? { date, time } : null
}

function clock(hour: string | undefined, minute: string | undefined, half: string | undefined): string | null {
  if (!hour || !minute) return null
  let h = +hour
  if (half?.toUpperCase() === 'PM' && h < 12) h += 12
  if (half?.toUpperCase() === 'AM' && h === 12) h = 0
  return h < 24 && +minute < 60 ? `${String(h).padStart(2, '0')}:${minute}` : null
}

/** "25" is 2025 and "99" is 1999: a two-digit year is never more than a year ahead. */
function fullYear(text: string): number {
  if (text.length === 4) return +text
  return +text <= (new Date().getUTCFullYear() % 100) + 1 ? 2000 + +text : 1900 + +text
}

/** 1-12 for a month's name or its usual abbreviation, 0 for any other word ("Marker", "Mayo"). */
function monthOf(word: string): number {
  const w = word.toLowerCase()
  return MONTH_NAMES.findIndex((name) => w === name || w === name.slice(0, 3) || (w === 'sept' && name === 'september')) + 1
}

/** Excel serial date to YYYY-MM-DD. Workbooks saved in the 1904 system count from four years and a day later. */
export function excelSerialToDate(serial: number, date1904 = false): string {
  return dateFromDay(Math.floor(serial) - 25569 + (date1904 ? 1462 : 0))
}
