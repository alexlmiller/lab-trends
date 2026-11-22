// Building blocks shared by the results page and the watchlist: the draw
// switcher, the range viewer, a result row with its expanded detail, and the
// previous → this draw comparison. Status is shown only when a value is
// outside its reported range, so anomalies stand out.
import { formatDate } from '../../shared/dates'
import { isOutOfRange, parseReferenceRange, relativeToReference, resultStatus, statusTone } from '../../shared/semantics'
import { numericUnitKey } from '../../shared/units'
import type { MarkerSeries, Panel, Result } from '../../shared/types'
import { useAction } from '../lib/action'
import { useDataset, useSavePreferences } from '../lib/data'
import { formatPct } from '../lib/format'
import { drawHistoryPath, drawPath } from '../lib/history'
import { priorResult, resultChange } from '../lib/report'
import { Icon } from './Icon'
import { SelectField } from './SelectField'
import { Button, ButtonAnchor, ButtonLink, cx, StatusBadge } from './ui'

export function drawLabel(p: Panel): string {
  return [formatDate(p.draw_date), p.draw_time].filter(Boolean).join(' · ')
}

/** Choose a draw: previous/next arrows plus a searchable list. Panels are newest first. */
export function DrawSwitcher({ panels, value, onChange, label = 'Report' }: { panels: Panel[]; value: string; onChange: (id: string) => void; label?: string }) {
  // Grows to fill the row on phones; fixed width beside other actions on wider screens.
  const i = Math.max(0, panels.findIndex((p) => p.id === value))
  const older = panels[i + 1]
  const newer = panels[i - 1]
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
      <Button size="sm" variant="ghost" icon="chevron-left" aria-label="Older draw" disabled={!older} onClick={() => older && onChange(older.id)} />
      <SelectField
        label={label}
        hideLabel
        size="sm"
        className="min-w-0 flex-1 sm:w-52 sm:flex-none"
        value={panels[i]?.id ?? ''}
        onChange={onChange}
        options={panels.map((p) => ({ value: p.id, label: drawLabel(p), detail: p.facility || p.panel_name || undefined, keywords: [p.draw_date, p.panel_name, p.facility].join(' ') }))}
      />
      <Button size="sm" variant="ghost" icon="chevron-right" aria-label="Newer draw" disabled={!newer} onClick={() => newer && onChange(newer.id)} />
    </div>
  )
}

/** HIGH/LOW for out-of-range values only; nothing for in-range or unranged results. */
export function OutOfRange({ result }: { result: Result }) {
  if (result.lab_flag === 'critical') return <StatusBadge status="critical" />
  const status = resultStatus(result)
  if (status === 'high' || status === 'low') return <StatusBadge status={status} />
  if (status === 'flagged') return <StatusBadge status="high">Flagged</StatusBadge>
  return null
}

/**
 * The value in its reported range: band = range, tick = this result, limits
 * labelled under the track. With `previous`, the earlier result is a hollow dot
 * joined to the tick by a line that points at this result.
 */
export function ReferenceGauge({ result, previous, size = 'sm', centered }: { result: Result; previous?: Result; size?: 'sm' | 'md'; centered?: boolean }) {
  const { ref_low: low, ref_high: high, value_numeric: value, comparator } = result
  if ((low == null && high == null) || (low != null && high != null && low > high)) return null
  const strict = parseReferenceRange(result.reference_text)?.strict === true
  const exact = value != null && (comparator ?? '=') === '='
  const direction = relativeToReference(result)
  const out = direction === 'high' || direction === 'low'
  const lowerLabel = low == null ? '' : (high == null ? (strict ? '>' : '≥') : '') + low
  const upperLabel = high == null ? '' : (low == null ? (strict ? '<' : '≤') : '') + high

  // Keep room outside each bound so an extreme result still lands on the track.
  const single = low == null || high == null || low === high
  const left = low == null ? 0 : single ? 50 : 25
  const right = high == null ? 100 : single ? 50 : 75
  const span = high != null && low != null && high > low ? high - low : Math.abs(low ?? high ?? 0) || 1
  const anchor = low ?? high!
  const place = (v: number) => (low != null && high != null && high > low ? left + ((v - low) * (right - left)) / span : 50 + ((v - anchor) * 40) / span)
  const clamp = (x: number) => Math.max(2, Math.min(98, x))
  const at = exact ? clamp(place(value)) : null
  const comparable =
    previous?.value_numeric != null && (previous.comparator ?? '=') === '=' && numericUnitKey(previous.raw_units) != null && numericUnitKey(previous.raw_units) === numericUnitKey(result.raw_units)
  const was = at != null && comparable ? clamp(place(previous.value_numeric!)) : null
  // Too close to draw the line and arrow: show nothing rather than a dot hidden under the tick.
  const moved = was != null && at != null && Math.abs(at - was) >= 4
  const range = [lowerLabel, low !== high ? upperLabel : ''].filter(Boolean).join(' to ')
  return (
    <span role="img" aria-label={[`Reported range ${range}`, `result ${result.raw_value}`, out ? (direction === 'high' ? 'above range' : 'below range') : null, moved ? `previous ${previous!.raw_value}` : null].filter(Boolean).join(', ')} className={cx('grid w-full gap-1 tabular', size === 'md' ? 'text-[12px]' : 'text-[11px]', centered && 'md:pt-[1.125rem]')}>
      <span aria-hidden className={cx('relative block rounded-full bg-sunken ring-1 ring-line ring-inset', size === 'md' ? 'h-2' : 'h-1.5')}>
        <span className="absolute inset-y-0 rounded-full bg-good/40" style={{ left: `${left}%`, right: `${100 - right}%` }} />
        {moved ? (
          <>
            <span className="absolute top-1/2 h-px -translate-y-1/2 bg-ink-faint" style={{ left: `${Math.min(at!, was!)}%`, right: `${100 - Math.max(at!, was!)}%` }} />
            <span
              className={cx('absolute top-1/2 size-0 -translate-y-1/2 border-y-[3.5px] border-y-transparent', at! > was! ? 'border-l-[5px] border-l-ink-faint' : 'border-r-[5px] border-r-ink-faint')}
              style={at! > was! ? { left: `calc(${at}% - 9px)` } : { left: `calc(${at}% + 4px)` }}
            />
          </>
        ) : null}
        {moved ? (
          <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-ink-faint bg-surface" style={{ left: `${was}%` }} />
        ) : null}
        {at != null ? (
          <span
            className={cx('absolute top-1/2 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface', size === 'md' ? 'h-4' : 'h-3', direction === 'high' ? 'bg-high' : direction === 'low' ? 'bg-low' : 'bg-ink')}
            style={{ left: `${at}%` }}
          />
        ) : null}
      </span>
      <span aria-hidden className="relative block h-3.5 text-ink-faint">
        {lowerLabel ? (
          <span className="absolute -translate-x-1/2" style={{ left: `${left}%` }}>
            {lowerLabel}
          </span>
        ) : null}
        {upperLabel && low !== high ? (
          <span className="absolute -translate-x-1/2" style={{ left: `${right}%` }}>
            {upperLabel}
          </span>
        ) : null}
      </span>
    </span>
  )
}

/** One result in a report list: name, value, range viewer, out-of-range status; expands in place. */
export function ResultRow({ marker, result, open, onToggle, onEdit, showDate, starred }: { marker: MarkerSeries; result: Result; open: boolean; onToggle: () => void; onEdit?: () => void; showDate?: boolean; starred?: boolean }) {
  const previous = priorResult(marker, { id: result.panel_id, draw_date: result.draw_date, draw_time: result.draw_time ?? null } as Panel)
  const tone = statusTone(resultStatus(result))
  const out = tone !== null
  return (
    <div className={cx('border-b border-line last:border-b-0', open && 'bg-elevated')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_7rem_1.25rem] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-left hover:bg-sunken/60 md:grid-cols-[minmax(9rem,16rem)_7rem_minmax(0,1fr)_4.5rem_1.25rem] md:gap-x-6"
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium text-ink">
            {starred ? <Icon name="star" filled className="shrink-0 text-star" /> : null}
            <span className="truncate">{marker.name}</span>
            {starred ? <span className="sr-only">(on your watchlist)</span> : null}
          </span>
          {showDate ? <span className="block text-[12px] text-ink-faint">{formatDate(result.draw_date)}</span> : null}
        </span>
        <span className={cx('text-left text-[14px] font-semibold whitespace-nowrap tabular', tone === 'high' && 'text-high', tone === 'low' && 'text-low')}>
          {result.raw_value} <span className="text-[12px] font-normal text-ink-faint">{result.raw_units}</span>
        </span>
        <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-3 md:col-span-1 md:row-start-auto md:contents">
          <span className="min-w-0 flex-1 md:flex-none">
            <ReferenceGauge result={result} previous={previous} centered />
            {result.ref_low == null && result.ref_high == null ? <span className="text-[12px] text-ink-faint">{result.reference_text || 'No reported range'}</span> : null}
          </span>
          <span className="shrink-0 md:text-right">{out ? <OutOfRange result={result} /> : null}</span>
        </span>
        <Icon name="chevron-down" className={cx('col-start-3 row-start-1 text-ink-faint transition-transform md:col-start-auto md:row-start-auto', open && 'rotate-180')} />
      </button>
      {open ? <ResultDetail marker={marker} result={result} onEdit={onEdit} /> : null}
    </div>
  )
}

/** Previous → this draw → change, for any two results of one test. */
export function ResultComparison({
  before,
  after,
  labels = ['Previous', 'This draw'],
  missing = ['No earlier result', 'Not tested'],
  drawDate,
  showPercent = true,
}: {
  before?: Result
  after?: Result
  labels?: [string, string]
  missing?: [string, string]
  drawDate?: string
  showPercent?: boolean
}) {
  const change = resultChange(before, after)
  const pct = showPercent && change.unit && before?.value_numeric != null && before.value_numeric > 0 && after?.value_numeric != null ? formatPct(after.value_numeric / before.value_numeric - 1) : null
  const cell = 'min-w-0 px-3 py-2.5 sm:px-4'
  return (
    <dl className="m-0 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line tabular">
      {[before, after].map((r, i) => {
        const d = r ? statusTone(resultStatus(r)) : null
        return (
          <div key={i} className={cx(cell, 'bg-surface')}>
            <dt className="text-[11.5px] text-ink-faint">{labels[i]}</dt>
            <dd className="m-0 mt-0.5">
              {r ? (
                <span className={cx('text-[17px] font-semibold', d === 'high' && 'text-high', d === 'low' && 'text-low')}>
                  {r.raw_value} <span className="text-[12px] font-normal text-ink-faint">{r.raw_units}</span>
                </span>
              ) : (
                <span className="text-[13px] text-ink-faint">{missing[i]}</span>
              )}
              {r || (i === 1 && drawDate) ? <span className="block text-[11.5px] text-ink-faint">{formatDate(r?.draw_date ?? drawDate)}</span> : null}
            </dd>
          </div>
        )
      })}
      <div className={cx(cell, 'bg-surface')}>
        <dt className="text-[11.5px] text-ink-faint">Change</dt>
        <dd className="m-0 mt-0.5">
          <span className="text-[17px] font-semibold">
            {change.value} <span className="text-[12px] font-normal text-ink-faint">{change.unit}</span>
          </span>
          <span className="block text-[11.5px] text-ink-faint">{[pct, change.note].filter(Boolean).join(' · ')}</span>
        </dd>
      </div>
    </dl>
  )
}

/** Expanded result: comparison, range viewer, reported details and where to go next. */
export function ResultDetail({ marker, result, panel: panelProp, onEdit }: { marker: MarkerSeries; result?: Result; panel?: Panel; onEdit?: () => void }) {
  const ds = useDataset()
  const panel = panelProp ?? ds.panels.find((p) => p.id === result?.panel_id)
  if (!panel) return null
  const previous = priorResult(marker, panel)
  const reported = result?.flag_source === 'reported' && result.lab_flag
  return (
    <div className="grid gap-4 border-t border-line px-3 pt-3 pb-4 sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink">{marker.long_name || marker.name}</div>
          <div className="text-[12px] text-ink-faint">{[drawLabel(panel), panel.facility].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ButtonLink size="sm" icon="chart" to={drawHistoryPath(marker.id, panel)}>
            Test history
          </ButtonLink>
          <FollowButton markerId={marker.id} />
        </div>
      </div>
      <ResultComparison before={previous} after={result} labels={[result ? 'Previous' : 'Last recorded', 'This draw']} drawDate={panel.draw_date} />
      {result && (result.ref_low != null || result.ref_high != null) ? (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-dim">
            <span>
              Reported range <span className="font-medium text-ink">{result.reference_text}</span>
            </span>
            {isOutOfRange(result) ? <OutOfRange result={result} /> : null}
            {reported ? <span className="text-ink-faint">flagged by the lab</span> : result.flag_source === 'inferred' && result.lab_flag ? <span className="text-ink-faint">from the reported range</span> : null}
          </div>
          <ReferenceGauge result={result} size="md" />
        </div>
      ) : result?.reference_text ? (
        <div className="text-[12px] text-ink-dim">
          Reported reference <span className="font-medium text-ink">{result.reference_text}</span>
        </div>
      ) : null}
      {result?.notes ? <p className="m-0 text-[13px] text-ink-dim">{result.notes}</p> : null}
      <div className="flex flex-wrap gap-2">
        {onEdit && result ? (
          <Button size="sm" variant="ghost" icon="pencil" onClick={onEdit}>
            Edit result
          </Button>
        ) : (
          <ButtonLink size="sm" variant="ghost" icon="file" to={drawPath(panel.id, result?.id)}>
            Open draw
          </ButtonLink>
        )}
        <SourceReports panel={panel} />
      </div>
    </div>
  )
}

/** A link to each uploaded report that put results on a draw. */
export function SourceReports({ panel }: { panel: Panel }) {
  const ds = useDataset()
  return (
    <>
      {panel.sources.map((s, i) => (
        <ButtonAnchor key={s.file_id} size="sm" variant="ghost" icon="external" title={s.filename} href={`/api/subjects/${encodeURIComponent(ds.subjectId)}/files/${encodeURIComponent(s.file_id)}`}>
          {panel.sources.length > 1 ? `Source report ${i + 1}` : 'Source report'}
        </ButtonAnchor>
      ))}
    </>
  )
}

/** Star a test onto the watchlist (shared with All tests and the watchlist page). */
export function FollowButton({ markerId, size = 'sm' }: { markerId: string; size?: 'sm' | 'md' }) {
  const ds = useDataset()
  const save = useSavePreferences()
  const { busy, run } = useAction()
  const starred = ds.preferences.starred_marker_ids
  const on = starred.includes(markerId)
  return (
    <Button
      size={size}
      variant={on ? 'secondary' : 'ghost'}
      busy={busy}
      aria-pressed={on}
      title={on ? 'On watchlist' : 'Add to watchlist'}
      className={cx('max-sm:px-2', on && 'text-accent-deep')}
      onClick={() => run(() => save({ starred_marker_ids: on ? starred.filter((id) => id !== markerId) : [...starred, markerId] }))}
    >
      {!busy && <Icon name="star" filled={on} className={on ? 'text-star' : undefined} />}
      <span className="max-sm:sr-only">{on ? 'On watchlist' : 'Watch'}</span>
    </Button>
  )
}
