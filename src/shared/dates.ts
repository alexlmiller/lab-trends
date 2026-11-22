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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(date: string | null | undefined, style: 'long' | 'short' | 'month' = 'long'): string {
  if (!date) return '—'
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  if (!y) return date
  if (style === 'month') return `${MONTHS[m - 1]} '${String(y).slice(-2)}`
  if (style === 'short') return `${MONTHS[m - 1]} ${d}`
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** Parse loose date strings from documents/sheets into YYYY-MM-DD (+ optional HH:MM). */
export function parseLooseDate(value: string | null | undefined): { date: string; time: string | null } | null {
  if (!value) return null
  const v = value.trim()
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/)
  if (m) return { date: ymd(+m[1], +m[2], +m[3]), time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null }
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M)?)?/i)
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    let time: string | null = null
    if (m[4]) {
      let h = +m[4]
      if (m[6]?.toUpperCase() === 'PM' && h < 12) h += 12
      if (m[6]?.toUpperCase() === 'AM' && h === 12) h = 0
      time = `${String(h).padStart(2, '0')}:${m[5]}`
    }
    return { date: ymd(year, +m[1], +m[2]), time }
  }
  m = v.match(/^([A-Za-z]{3,9})[-\s]+(\d{2,4})$/)
  if (m) {
    const month = MONTHS.findIndex((x) => m![1].toLowerCase().startsWith(x.toLowerCase())) + 1
    if (month > 0) return { date: ymd(m[2].length === 2 ? 2000 + +m[2] : +m[2], month, 1), time: null }
  }
  m = v.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (m) {
    const month = MONTHS.findIndex((x) => m![1].toLowerCase().startsWith(x.toLowerCase())) + 1
    if (month > 0) return { date: ymd(+m[3], month, +m[2]), time: null }
  }
  return null
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Excel serial date (1900 system) to YYYY-MM-DD. */
export function excelSerialToDate(serial: number): string {
  return dateFromDay(Math.floor(serial) - 25569)
}
