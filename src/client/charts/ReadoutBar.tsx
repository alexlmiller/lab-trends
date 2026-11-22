// The draw under the cursor (or the pinned one) and each test's value on it,
// above the chart so the plot stays clear. Arrows step between draws in view.
import { formatDate } from '../../shared/dates'
import { activeOn } from '../../shared/events'
import type { MarkerSeries, Panel, TimelineEvent } from '../../shared/types'
import { Button, ButtonLink, cx } from '../components/ui'
import { resultStatus, statusTone } from '../../shared/semantics'
import { seriesColor, STATUS_PHRASE } from '../lib/series'
import { drawPath } from '../lib/history'

type Props = {
  markers: MarkerSeries[]
  panel?: Panel
  latest: boolean
  events: TimelineEvent[]
  older?: () => void
  newer?: () => void
}

export function ReadoutBar({ markers, panel, latest, events, older, newer }: Props) {
  if (!panel) return <p className="m-0 border-b border-line px-4 py-3 text-[13px] text-ink-faint">No draws in this range</p>
  const active = events.filter((e) => e.periods.some((period) => activeOn(period, panel.draw_date)))
  const context = [latest ? 'Latest draw' : 'Selected draw', panel.facility, ...active.map((e) => e.label)].filter(Boolean).join(' · ')
  // Phones: date and "Open draw" share the first row, values wrap below.
  return (
    <div role="group" aria-label="Draw readings" className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-line bg-sunken/50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-1 max-sm:flex-1">
        <Button size="sm" variant="ghost" icon="chevron-left" aria-label="Older draw" disabled={!older} onClick={older} />
        <div className="min-w-0 sm:min-w-[8.5rem]">
          <div className="text-[13px] font-semibold text-ink tabular">{[formatDate(panel.draw_date), panel.draw_time].filter(Boolean).join(' · ')}</div>
          <div className="truncate text-[11.5px] text-ink-faint sm:max-w-[22rem]" title={context}>
            {context}
          </div>
        </div>
        <Button size="sm" variant="ghost" icon="chevron-right" aria-label="Newer draw" disabled={!newer} onClick={newer} />
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-1 max-sm:order-last max-sm:w-full max-sm:gap-x-4 max-sm:pl-1">
      {markers.map((m, index) => {
        const r = m.results.find((x) => x.panel_id === panel.id)
        const status = resultStatus(r)
        const d = statusTone(status)
        return (
          <div key={m.id} className="flex min-w-0 items-baseline gap-1.5">
            <span aria-hidden className="inline-block size-2.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: seriesColor(index) }} />
            {markers.length > 1 ? <span className="max-w-[9rem] truncate text-[12.5px] text-ink-dim">{m.name}</span> : null}
            {r ? (
              <>
                <span className={cx('text-[16px] leading-none font-semibold tabular', d === 'high' && 'text-high', d === 'low' && 'text-low')}>{r.raw_value}</span>
                <span className="text-[12px] text-ink-faint">{r.raw_units}</span>
                {d ? <span className={cx('text-[11.5px] font-medium', d === 'high' ? 'text-high' : 'text-low')}>{STATUS_PHRASE[status]}</span> : null}
              </>
            ) : (
              <span className="text-[13px] text-ink-faint">not tested</span>
            )}
          </div>
        )
      })}
      </div>
      <ButtonLink to={drawPath(panel.id)} size="sm" variant="ghost" icon="file" className="ml-auto shrink-0" aria-label="Open draw">
        <span className="max-sm:hidden">Open draw</span>
      </ButtonLink>
    </div>
  )
}
