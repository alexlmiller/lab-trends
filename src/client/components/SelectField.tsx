// Dropdowns. Every choice list in the app goes through these two components so
// they look and behave the same:
//  SelectField – a button that opens a listbox. Lists longer than five options
//                get a search box at the top.
//  SearchField – a search-first combobox (type to find), used to add a test.
// Both render their list in the top layer, so they work inside dialogs and
// horizontally scrolling tables.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Icon } from './Icon'
import { cx } from './ui'

export type Choice = { value: string; label: string; detail?: string; keywords?: string }

const SEARCH_THRESHOLD = 5

const triggerClass = (size: 'sm' | 'md') =>
  cx(
    'flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line-strong bg-surface text-left text-ink transition-colors hover:border-ink-faint focus-visible:border-accent focus-visible:outline-none aria-expanded:border-accent',
    size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3 text-sm',
  )

const labelClass = 'mb-1 block text-[12px] font-medium text-ink-dim'

type Props = {
  label: string
  value: string
  options: Choice[]
  onChange: (value: string) => void
  hideLabel?: boolean
  className?: string
  size?: 'sm' | 'md'
  placeholder?: string
  /** Force the search box on or off (default: on for more than five options). */
  searchable?: boolean
  /** Replace the default trigger, e.g. a page title that switches tests. */
  renderTrigger?: (props: TriggerProps, selected: Choice | undefined) => ReactNode
}

export type TriggerProps = {
  ref: RefObject<HTMLButtonElement | null>
  id: string
  type: 'button'
  'aria-haspopup': 'listbox'
  'aria-expanded': boolean
  'aria-controls'?: string
  'aria-label'?: string
  onClick: () => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
}

export function SelectField({ label, value, options, onChange, hideLabel, className, size = 'md', placeholder = 'Choose…', searchable, renderTrigger }: Props) {
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD
  const selected = options.find((o) => o.value === value)
  const matches = filterChoices(options, query)
  const index = Math.min(active, matches.length - 1)

  const close = (refocus = true) => {
    setOpen(false)
    setQuery('')
    if (refocus) button.current?.focus()
  }
  const show = () => {
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const choose = (o: Choice) => {
    close()
    if (o.value !== value) onChange(o.value)
  }

  useAnchoredPopover(open, wrap, button, panel, () => close(false))
  useEffect(() => {
    if (open) (withSearch ? search.current : list.current)?.focus({ preventScroll: true })
  }, [open, withSearch])
  useScrollActive(open, list, index, query)

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return close()
    }
    if (e.key === 'Tab') return close(false)
    if (e.key === 'Enter' || (e.key === ' ' && !withSearch)) {
      e.preventDefault()
      if (matches[index]) choose(matches[index])
      return
    }
    const step = listKeyStep(e.key, index, matches.length, Boolean(query))
    if (step != null) {
      e.preventDefault()
      return setActive(step)
    }
    // Typeahead when there is no search box.
    if (!withSearch && e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLocaleLowerCase()
      const from = matches.findIndex((o, i) => i > index && o.label.toLocaleLowerCase().startsWith(k))
      const hit = from >= 0 ? from : matches.findIndex((o) => o.label.toLocaleLowerCase().startsWith(k))
      if (hit >= 0) setActive(hit)
    }
  }

  const trigger: TriggerProps = {
    ref: button,
    id,
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': open,
    'aria-controls': open ? `${id}-list` : undefined,
    'aria-label': hideLabel || renderTrigger ? `${label}: ${selected?.label ?? placeholder}` : undefined,
    onClick: () => (open ? close() : show()),
    onKeyDown: (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
    },
  }

  return (
    <div ref={wrap} className={cx('relative min-w-0', className)}>
      {!hideLabel && !renderTrigger ? (
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
      ) : null}
      {renderTrigger ? (
        renderTrigger(trigger, selected)
      ) : (
        <button {...trigger} className={triggerClass(size)}>
          <span className="min-w-0 truncate">{selected ? selected.label : <span className="text-ink-faint">{placeholder}</span>}</span>
          <Icon name="chevron-down" className="shrink-0 text-ink-faint" />
        </button>
      )}
      {open ? (
        <div ref={panel} popover="manual" onKeyDown={onKeyDown} className={panelClass}>
          {withSearch ? (
            <SearchBox
              inputRef={search}
              value={query}
              label={`Search ${label.toLocaleLowerCase()}`}
              listId={`${id}-list`}
              activeId={index >= 0 ? `${id}-${index}` : undefined}
              onChange={(v) => {
                setQuery(v)
                setActive(0)
              }}
            />
          ) : null}
          <OptionList
            listRef={list}
            id={`${id}-list`}
            label={label}
            options={matches}
            value={value}
            active={index}
            focusable={!withSearch}
            onHover={setActive}
            onChoose={choose}
          />
          {!matches.length ? <p className="px-2.5 py-2 text-[13px] text-ink-faint">No matches</p> : null}
        </div>
      ) : null}
    </div>
  )
}

type SearchProps = {
  label: string
  onChange: (value: string) => void
  /** Returns the choices for a query ('' when the field is first opened). */
  filterOptions: (query: string) => Choice[]
  hideLabel?: boolean
  className?: string
  size?: 'sm' | 'md'
  placeholder?: string
  autoFocus?: boolean
  suggestionsLabel?: string
}

/** Type-to-find combobox. Picking an option clears the field (it adds, it doesn't hold a value). */
export function SearchField({ label, onChange, filterOptions, hideLabel, className, size = 'md', placeholder, autoFocus, suggestionsLabel }: SearchProps) {
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const matches = open ? filterOptions(query) : []
  const index = Math.min(active, matches.length - 1)

  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const choose = (o: Choice) => {
    close()
    input.current?.blur()
    onChange(o.value)
  }
  useAnchoredPopover(open, wrap, input, panel, close)
  useScrollActive(open, list, index, query)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      return close()
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!open) return setOpen(true)
      if (matches[index]) choose(matches[index])
      return
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      return setOpen(true)
    }
    const step = listKeyStep(e.key, index, matches.length, Boolean(query))
    if (step != null) {
      e.preventDefault()
      setActive(step)
    }
  }

  return (
    <div ref={wrap} className={cx('relative min-w-0', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : labelClass}>
        {label}
      </label>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint" />
        <input
          id={id}
          ref={input}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={open && index >= 0 ? `${id}-${index}` : undefined}
          placeholder={placeholder}
          value={query}
          onFocus={() => {
            setActive(0)
            setOpen(true)
          }}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          className={cx(triggerClass(size), 'pl-8 placeholder:text-ink-faint')}
        />
      </div>
      {open ? (
        <div ref={panel} popover="manual" className={panelClass}>
          {suggestionsLabel && !query && matches.length ? <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">{suggestionsLabel}</div> : null}
          <OptionList listRef={list} id={`${id}-list`} label={label} options={matches} value="" active={index} onHover={setActive} onChoose={choose} />
          {!matches.length ? <p className="px-2.5 py-2 text-[13px] text-ink-faint">{query ? 'No matches' : 'Nothing to add'}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

// ─── Shared pieces ───────────────────────────────────────────────────────

const panelClass = 'fixed inset-auto m-0 flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface p-1 text-ink shadow-xl'

function SearchBox({ inputRef, value, onChange, label, listId, activeId }: { inputRef: RefObject<HTMLInputElement | null>; value: string; onChange: (v: string) => void; label: string; listId: string; activeId?: string }) {
  return (
    <div className="relative mb-1 shrink-0">
      <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border border-line bg-sunken pr-2 pl-8 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none pointer-coarse:h-10"
      />
    </div>
  )
}

function OptionList({
  listRef,
  id,
  label,
  options,
  value,
  active,
  focusable,
  onHover,
  onChoose,
}: {
  listRef: RefObject<HTMLUListElement | null>
  id: string
  label: string
  options: Choice[]
  value: string
  active: number
  focusable?: boolean
  onHover: (i: number) => void
  onChoose: (o: Choice) => void
}) {
  return (
    <ul
      ref={listRef}
      role="listbox"
      id={id}
      aria-label={label}
      tabIndex={focusable ? -1 : undefined}
      aria-activedescendant={focusable && active >= 0 ? `${id.replace(/-list$/, '')}-${active}` : undefined}
      className="min-h-0 overflow-y-auto overscroll-contain outline-none"
    >
      {options.map((o, i) => {
        const chosen = o.value === value && value !== ''
        return (
          <li
            key={o.value}
            id={`${id.replace(/-list$/, '')}-${i}`}
            role="option"
            aria-selected={chosen}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => i !== active && onHover(i)}
            onClick={() => onChoose(o)}
            className={cx(
              'flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px] pointer-coarse:min-h-11',
              i === active && 'bg-accent-tint',
              chosen ? 'font-semibold text-accent-deep' : 'text-ink',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate">{o.label}</span>
              {o.detail ? <span className="block truncate text-[11.5px] font-normal text-ink-faint">{o.detail}</span> : null}
            </span>
            {chosen ? <Icon name="check" className="shrink-0" /> : null}
          </li>
        )
      })}
    </ul>
  )
}

function filterChoices(options: Choice[], query: string): Choice[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return options
  return options.filter((o) => [o.label, o.detail, o.keywords].some((t) => t?.toLocaleLowerCase().includes(q)))
}

function listKeyStep(key: string, index: number, count: number, typing: boolean): number | null {
  if (!count) return null
  if (key === 'ArrowDown') return Math.min(index + 1, count - 1)
  if (key === 'ArrowUp') return Math.max(index - 1, 0)
  if (!typing && key === 'Home') return 0
  if (!typing && key === 'End') return count - 1
  if (key === 'PageDown') return Math.min(index + 8, count - 1)
  if (key === 'PageUp') return Math.max(index - 8, 0)
  return null
}

function useScrollActive(open: boolean, list: RefObject<HTMLUListElement | null>, index: number, query: string) {
  useEffect(() => {
    if (open && index >= 0) (list.current?.children[index] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [open, index, query, list])
}

/** Place the open panel under (or above) its trigger and close it on outside presses. */
function useAnchoredPopover(open: boolean, wrap: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, dismiss: () => void) {
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss
  useLayoutEffect(() => {
    if (!open) return
    const el = panel.current
    const a = anchor.current
    if (!el || !a) return
    el.showPopover?.()
    const position = () => {
      const rect = a.getBoundingClientRect()
      const vv = window.visualViewport
      const top = vv?.offsetTop ?? 0
      const bottom = top + (vv?.height ?? window.innerHeight)
      const vw = document.documentElement.clientWidth
      const width = Math.min(Math.max(rect.width, 240), vw - 16)
      const below = bottom - rect.bottom - 8
      const above = rect.top - top - 8
      const flip = below < 220 && above > below
      el.style.width = `${width}px`
      el.style.left = `${Math.max(8, Math.min(rect.left, vw - width - 8))}px`
      el.style.maxHeight = `${Math.max(120, Math.min(340, flip ? above : below))}px`
      el.style.top = `${flip ? rect.top - el.offsetHeight - 4 : rect.bottom + 4}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(el)
    observer.observe(a)
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    vv(window)?.addEventListener('resize', position)
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (!wrap.current?.contains(t) && !el.contains(t)) dismissRef.current()
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      if (el.isConnected) el.hidePopover?.()
      observer.disconnect()
      window.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
      vv(window)?.removeEventListener('resize', position)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open, wrap, anchor, panel])
}

const vv = (w: Window) => w.visualViewport
