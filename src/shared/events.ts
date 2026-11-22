import { formatDate, isValidDate } from './dates'
import type { EventKind, EventPeriod, TimelineEvent } from './types'

/** Every kind of timeline event, in the order they are offered. */
export const EVENT_KINDS = ['medication', 'procedure', 'illness', 'lifestyle', 'location', 'other'] as const satisfies readonly EventKind[]

export function periodLabel(p: EventPeriod): string {
  const start = formatDate(p.start_date)
  if (p.ongoing) return start + ' – ongoing'
  return p.end_date && p.end_date !== p.start_date ? start + ' – ' + formatDate(p.end_date) : start
}

export function activeOn(p: EventPeriod, date: string): boolean {
  return p.start_date <= date && (p.end_date ? date <= p.end_date : p.ongoing || p.start_date === date)
}

// Keep the event identity for editing. Each occurrence needs its own chart lane key.
export function chartOccurrences(events: TimelineEvent[]) {
  return events.flatMap((event) =>
    event.periods.map((period) => ({
      ...event,
      ...period,
      id: event.id + '/' + period.start_date,
    })),
  )
}

const calendarDate = (s: unknown): s is string => typeof s === 'string' && isValidDate(s)

export function validatedPeriods(input: unknown): EventPeriod[] {
  if (!Array.isArray(input) || !input.length) throw new Error('Add at least one date or period.')
  const periods = input
    .map((p): EventPeriod => {
      if (!p || !calendarDate(p.start_date)) throw new Error('Each period needs a valid start date.')
      const end = p.end_date || null
      if (end && (!calendarDate(end) || end < p.start_date)) throw new Error('End dates must be on or after their start dates.')
      if (p.ongoing != null && typeof p.ongoing !== 'boolean') throw new Error('Ongoing must be true or false.')
      if (p.ongoing && end) throw new Error('An ongoing period cannot have an end date.')
      if (p.note != null && typeof p.note !== 'string') throw new Error('Period notes must be text.')
      const note = typeof p.note === 'string' ? p.note.trim().slice(0, 500) || null : null
      return { start_date: p.start_date, end_date: end, ongoing: p.ongoing === true, note }
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  for (let i = 1; i < periods.length; i++) {
    if (activeOn(periods[i - 1], periods[i].start_date))
      throw new Error('Dates for the same event overlap. Check the end of the earlier period.')
  }
  return periods
}
