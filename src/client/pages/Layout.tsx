import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { Icon, type IconName } from '../components/Icon'
import { Alert, Button, cx, Eyebrow, Field, inputClass, PageHeader, Spinner } from '../components/ui'
import { SelectField } from '../components/SelectField'
import { SetupScreen } from '../components/SetupScreen'
import { api } from '../lib/api'
import { DataProvider, useData } from '../lib/data'

type Destination = { to: string; label: string; icon: IconName }
const report: Destination = { to: '/', label: 'Latest results', icon: 'file' }
const allTests: Destination = { to: '/markers', label: 'All tests', icon: 'flask' }
const sections: { title: string; links: Destination[] }[] = [
  {
    title: 'Explore',
    links: [
      report,
      allTests,
      { to: '/grid', label: 'Timeline', icon: 'grid' },
      { to: '/correlations', label: 'Correlations', icon: 'scatter' },
    ],
  },
  {
    title: 'Manage',
    links: [
      { to: '/watchlist', label: 'Watchlist', icon: 'star' },
      { to: '/draws', label: 'Draws', icon: 'file' },
      { to: '/events', label: 'Events', icon: 'calendar' },
      { to: '/import', label: 'Import results', icon: 'upload' },
      { to: '/catalog', label: 'Test catalog', icon: 'tag' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

const quickClass = 'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md text-[11.5px] text-ink-dim no-underline'
const quickActive = 'bg-accent-tint font-semibold text-accent-deep'

const navLink = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] no-underline transition-colors max-lg:min-h-11',
    isActive ? 'bg-accent-tint font-semibold text-accent-deep' : 'font-medium text-ink-dim hover:bg-sunken hover:text-ink',
  )

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="All pages" className="grid gap-5">
      {sections.map((section) => (
        <div key={section.title} className="grid gap-0.5">
          <Eyebrow className="mb-1 px-2.5">{section.title}</Eyebrow>
          {section.links.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onNavigate} className={navLink}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

export function Layout() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

function Shell() {
  const { me, gate, subjectId, setSubjectId, dataset, loading, error } = useData()
  const { pathname } = useLocation()
  const menu = useRef<HTMLDialogElement>(null)
  const main = useRef<HTMLElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return
    const dialog = menu.current!
    dialog.showModal()
    const wide = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => {
      if (wide.matches) dialog.close()
    }
    wide.addEventListener('change', closeOnDesktop)
    return () => wide.removeEventListener('change', closeOnDesktop)
  }, [menuOpen])
  useEffect(() => {
    const destination = sections
      .flatMap((section) => section.links)
      .find((link) => pathname === link.to || (link.to !== '/' && pathname.startsWith(link.to + '/')))
    document.title = destination && !gate ? destination.label + ' · Lab Trends' : 'Lab Trends'
    menu.current?.close()
    window.scrollTo(0, 0)
  }, [pathname, gate])
  const needsPerson = me && me.subjects.length === 0
  const onQuickPage = pathname === '/' || pathname === '/markers'
  if (gate) return <SetupScreen gate={gate} />

  return (
    <div className="min-h-dvh">
      <a href="#main-content" className="fixed top-2 left-2 z-[60] -translate-y-[200%] rounded-md bg-surface px-3 py-2 text-sm shadow focus:translate-y-0">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[100rem] items-center gap-2 px-3 sm:px-5 lg:px-8">
          <NavLink to="/" aria-label="Lab Trends home" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em] whitespace-nowrap text-ink no-underline">
            <span className="grid size-8 place-items-center rounded-lg bg-accent-deep text-paper">
              <Icon name="chart" />
            </span>
            Lab Trends
          </NavLink>
          <div className="ml-auto flex min-w-0 items-center gap-2 text-[13px] text-ink-dim">
            {me && me.subjects.length > 1 ? (
              <SelectField
                label="Person"
                hideLabel
                size="sm"
                className="w-44"
                value={subjectId ?? ''}
                onChange={setSubjectId}
                options={me.subjects.map((person) => ({ value: person.id, label: person.display_name }))}
              />
            ) : dataset ? (
              <>
                <Icon name="user" className="shrink-0" />
                <span className="truncate">{dataset.subject.display_name}</span>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[100rem] lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto border-r border-line px-3 py-6 lg:block">
          <Navigation />
        </aside>
        <main id="main-content" ref={main} tabIndex={-1} className="min-w-0 px-4 pt-6 pb-28 outline-none sm:px-6 lg:px-10 lg:pt-8 lg:pb-16">
          {error ? (
            <Alert tone="error">{error}</Alert>
          ) : needsPerson ? (
            <FirstPerson />
          ) : loading || !dataset ? (
            <div className="py-24">
              <Spinner label="Loading results…" />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      <nav aria-label="Quick access" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 gap-1 border-t border-line bg-surface/95 px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        {[report, allTests].map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => cx(quickClass, isActive && !menuOpen && quickActive)}>
            <Icon name={item.icon} size={20} />
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className={cx(quickClass, (menuOpen || !onQuickPage) && quickActive)}
        >
          <Icon name="menu" size={20} />
          More
        </button>
      </nav>
      {menuOpen && (
        <dialog
          ref={menu}
          aria-labelledby="nav-title"
          onClose={() => setMenuOpen(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) menu.current?.close()
          }}
          className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(20rem,88vw)] max-w-none bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
        >
          <div className="px-3 pt-2 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between pl-2.5">
              <h2 id="nav-title" className="m-0 text-base font-semibold">
                All pages
              </h2>
              <button type="button" aria-label="Close navigation" onClick={() => menu.current?.close()} className="grid size-11 place-items-center rounded-md text-ink-dim hover:bg-sunken">
                <Icon name="x" size={20} />
              </button>
            </div>
            <Navigation
              onNavigate={() => {
                menu.current?.close()
                main.current?.focus({ preventScroll: true })
              }}
            />
          </div>
        </dialog>
      )}
    </div>
  )
}

function FirstPerson() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="mx-auto max-w-md py-16">
      <PageHeader title="Whose results are these?" description="Create a person to start importing lab results. You can add more people later in settings." />
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await api.post('/subjects', { display_name: name })
            window.location.reload()
          } catch (err) {
            setError((err as Error).message)
            setBusy(false)
          }
        }}
      >
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={busy}>
            Continue
          </Button>
        </div>
      </form>
    </div>
  )
}
