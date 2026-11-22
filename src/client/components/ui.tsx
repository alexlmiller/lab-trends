import { useEffect, useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router'
import { Icon, type IconName } from './Icon'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cx(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
    variant === 'primary' && 'border-accent bg-accent text-white hover:bg-accent-deep dark:text-paper',
    variant === 'secondary' && 'border-line-strong bg-surface text-ink hover:bg-elevated',
    variant === 'ghost' && 'border-transparent bg-transparent text-ink-dim hover:bg-accent-tint hover:text-ink',
    variant === 'danger' && 'border-high/40 bg-surface text-high hover:bg-high-tint',
    className,
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  busy?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} disabled={disabled || busy} className={buttonClass(variant, size, className)}>
      {busy ? <Icon name="loader" spin /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

/** A router link that looks like a Button. */
export function ButtonLink({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName }) {
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  )
}

/** An external or file link that looks like a Button (opens in a new tab). */
export function ButtonAnchor({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName }) {
  return (
    <a target="_blank" rel="noreferrer" {...rest} className={buttonClass(variant, size, className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </a>
  )
}

/** Inline text link inside prose and tables. */
export const linkClass = 'font-medium text-accent-deep underline-offset-2 hover:underline'

/** One header for every page: optional back link and eyebrow, title, description, actions. */
export function PageHeader({ title, titleAction, eyebrow, description, actions, back }: { title: ReactNode; titleAction?: ReactNode; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-5 grid gap-3 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-6">
      <div className="min-w-0">
        {back}
        {eyebrow ? <Eyebrow className="mb-1">{eyebrow}</Eyebrow> : null}
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="m-0 min-w-0 font-display text-[26px] leading-[1.15] font-medium tracking-[-0.02em] text-ink sm:text-[30px]">{title}</h1>
          {titleAction}
        </div>
        {description ? <div className="mt-1.5 text-[13px] text-ink-dim">{description}</div> : null}
      </div>
      {actions ? <div className="flex min-w-0 items-center gap-2 max-sm:flex-nowrap sm:flex-wrap">{actions}</div> : null}
    </header>
  )
}

/** Back to wherever the user came from; falls back to a fixed page on a fresh load. */
export function BackLink({ fallback, fallbackLabel }: { fallback: string; fallbackLabel: string }) {
  const navigate = useNavigate()
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  const cls = 'mb-2 inline-flex items-center gap-1 rounded text-[13px] text-ink-dim no-underline hover:text-ink'
  return canGoBack ? (
    <button type="button" onClick={() => navigate(-1)} className={cls}>
      <Icon name="chevron-left" /> Back
    </button>
  ) : (
    <Link to={fallback} className={cls}>
      <Icon name="chevron-left" /> {fallbackLabel}
    </Link>
  )
}

/** Section title with optional meta text and actions on the right. */
export function SectionHeader({ title, meta, actions, className }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1', className)}>
      <h2 className="m-0 text-[15px] font-semibold text-ink">{title}</h2>
      {meta ? <span className="text-[12.5px] text-ink-faint">{meta}</span> : null}
      {actions ? <div className="ml-auto flex items-center gap-2 self-center">{actions}</div> : null}
    </div>
  )
}

/** A row of figures with hairline dividers, for any count and any column count. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid gap-px overflow-hidden rounded-lg border border-line bg-line', className)}>{children}</div>
}

export function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5 truncate text-[20px] leading-tight font-semibold tabular">{children}</div>
      {sub ? <div className="mt-1 truncate text-[11.5px] text-ink-faint">{sub}</div> : null}
    </div>
  )
}

/** Collapsible section with a styled summary (no native disclosure triangle). */
export function Disclosure({ title, meta, children, defaultOpen, onToggle, className }: { title: ReactNode; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean; onToggle?: (open: boolean) => void; className?: string }) {
  return (
    <details open={defaultOpen} onToggle={(e) => onToggle?.(e.currentTarget.open)} className={cx('group rounded-lg border border-line bg-surface', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-right" className="shrink-0 text-ink-faint transition-transform group-open:rotate-90" />
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        {meta ? <span className="ml-auto text-[12.5px] text-ink-faint">{meta}</span> : null}
      </summary>
      <div className="border-t border-line px-4 py-3">{children}</div>
    </details>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md border border-line-strong bg-sunken p-0.5 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'shrink-0 rounded-[5px] px-2.5 font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'h-6 text-[12px]' : 'h-8 text-[13px]',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-dim hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase', className)}>{children}</div>
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx('rounded-lg border border-line bg-surface', padded && 'p-4', className)}>{children}</div>
}

export function Empty({ title, children, icon = 'flask' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-line-strong bg-sunken/50 px-6 py-12 text-center">
      <Icon name={icon} size={24} className="text-ink-faint" />
      <div className="font-semibold text-ink">{title}</div>
      {children ? <div className="max-w-md text-[13px] text-ink-dim">{children}</div> : null}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-dim">
      <Icon name="loader" spin /> {label}
    </div>
  )
}

export function StatusBadge({ status, children }: { status: 'low' | 'high' | 'in' | 'unknown' | 'critical'; children?: ReactNode }) {
  const label = children ?? (status === 'low' ? 'Low' : status === 'high' ? 'High' : status === 'critical' ? 'Critical' : status === 'in' ? 'In range' : 'No range')
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold tracking-[0.04em] uppercase',
        status === 'low' && 'bg-low-tint text-low',
        (status === 'high' || status === 'critical') && 'bg-high-tint text-high',
        status === 'in' && 'bg-good-tint text-good',
        status === 'unknown' && 'bg-sunken text-ink-faint',
      )}
    >
      {label}
    </span>
  )
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const pressedBackdrop = useRef(false)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    // Start in the first field with a mouse; on touch, don't pop the keyboard or ring the close button.
    const field = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? (window.matchMedia('(pointer: fine)').matches ? dialog.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, select') : null)
    ;(field ?? body.current)?.focus({ preventScroll: true })
  }, [])
  // Close only when a press starts and ends on the backdrop: on phones the keyboard can shift
  // the dialog between touch and click, which would otherwise land a tap on the backdrop.
  const onBackdrop = (e: { target: EventTarget; clientX: number; clientY: number }) => {
    const dialog = ref.current
    if (!dialog || e.target !== dialog) return false
    const r = dialog.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onPointerDown={(e) => {
        pressedBackdrop.current = onBackdrop(e)
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && onBackdrop(e)) onClose()
        pressedBackdrop.current = false
      }}
      className={cx(
        'm-auto max-h-[90dvh] w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-ink-dim outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-accent">
          <Icon name="x" />
        </button>
      </div>
      <div ref={body} tabIndex={-1} className="max-h-[calc(90dvh-120px)] overflow-y-auto px-5 py-4 outline-none">
        {children}
      </div>
      {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
    </dialog>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid content-start gap-1">
      <span className="text-[12px] font-medium text-ink-dim">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-ink-faint">{hint}</span> : null}
    </label>
  )
}

export const inputClass =
  'h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

export function Chip({ active, onClick, children, title }: { active?: boolean; onClick?: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors',
        active ? 'border-accent bg-accent-tint text-accent-deep' : 'border-line-strong bg-surface text-ink-dim hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function Alert({ tone = 'warn', children }: { tone?: 'warn' | 'error' | 'info'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'flex gap-2 rounded-md border px-3 py-2 text-[13px]',
        tone === 'warn' && 'border-warn/30 bg-warn-tint text-ink',
        tone === 'error' && 'border-high/30 bg-high-tint text-ink',
        tone === 'info' && 'border-line bg-sunken text-ink-dim',
      )}
    >
      <Icon name="alert" className={cx('mt-0.5 shrink-0', tone === 'error' ? 'text-high' : tone === 'warn' ? 'text-warn' : 'text-ink-faint')} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** A value to copy elsewhere (a URL, a command), with a Copy button. */
export function CopyRow({ label, value, mono }: { label?: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-1">
      {label ? <span className="text-[12px] font-medium text-ink-dim">{label}</span> : null}
      <div className="flex min-w-0 items-center gap-2">
        <code className={cx('min-w-0 flex-1 truncate rounded-md border border-line bg-sunken px-2.5 py-1.5 text-[12.5px] text-ink', mono && 'font-mono')} title={value}>
          {value}
        </code>
        <Button
          size="sm"
          icon={copied ? 'check' : 'copy'}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              setCopied(false)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}
