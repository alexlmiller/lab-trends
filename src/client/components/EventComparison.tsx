import { formatDate } from '../../shared/dates'
import { periodLabel } from '../../shared/events'
import type { MarkerSeries, TimelineEvent, EventPeriod } from '../../shared/types'
import { useParam, useUpdateParams } from '../lib/data'
import { SelectField } from './SelectField'
import { ResultComparison } from './ReportParts'
import { ButtonLink, Card, Segmented, SectionHeader } from './ui'

export function EventComparison({ event, period, markers }: { event: TimelineEvent; period: EventPeriod; markers: MarkerSeries[] }) {
  const [edge, setEdge] = useParam('edge', 'start')
  const update = useUpdateParams()
  const boundary = edge === 'end' && period.end_date ? period.end_date : period.start_date
  return (
    <section id="event-comparison" aria-label="Event comparison" className="scroll-mt-20">
      <SectionHeader title={`Before and after ${event.label}`} actions={<ButtonLink to="/events" size="sm" variant="ghost" icon="calendar">Events</ButtonLink>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
          {event.periods.length > 1 ? (
            <SelectField
              label="Period"
              size="sm"
              className="w-60"
              value={period.start_date}
              options={[...event.periods].reverse().map((p) => ({ value: p.start_date, label: periodLabel(p), keywords: p.end_date ?? '' }))}
              onChange={(date) => update({ period: date, edge: null })}
            />
          ) : null}
          {period.end_date && period.end_date !== period.start_date ? (
            <Segmented
              label="Compare around"
              value={edge === 'end' ? 'end' : 'start'}
              options={[
                { value: 'start', label: 'Start' },
                { value: 'end', label: 'End' },
              ]}
              onChange={setEdge}
            />
          ) : null}
          <p className="m-0 text-[12.5px] text-ink-dim">
            Nearest results on either side of <span className="font-semibold text-ink">{formatDate(boundary)}</span>
          </p>
        </div>
        <div className="grid">
          {markers.map((m) => (
            <div key={m.id} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] md:items-center md:gap-4">
              <h3 className="m-0 text-[14px] font-medium text-ink">{m.name}</h3>
              <ResultComparison
                before={m.results.findLast((r) => r.draw_date < boundary)}
                after={m.results.find((r) => r.draw_date > boundary)}
                labels={['Before', 'After']}
                missing={['No earlier result', 'No later result']}
              />
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}
