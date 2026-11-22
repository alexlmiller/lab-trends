import type { ReactNode } from 'react'
import type { Gate } from '../lib/data'
import { Icon } from './Icon'
import { Button, ButtonAnchor, Card, CopyRow, linkClass } from './ui'

const ACCESS_GUIDE = 'https://developers.cloudflare.com/workers/configuration/cloudflare-access/'
const WORKERS_DASHBOARD = 'https://dash.cloudflare.com/?to=/:account/workers-and-pages'
const D1_DASHBOARD = 'https://dash.cloudflare.com/?to=/:account/workers/d1'

/** Shown instead of the app while the Worker refuses to serve it (src/worker/auth.ts). Keep the steps in step with docs/deploying.md "Turn on sign-in". */
export function SetupScreen({ gate }: { gate: Gate }) {
  return (
    <div className="mx-auto grid min-h-dvh max-w-xl content-start gap-5 px-4 py-10 sm:py-16">
      <div className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em] text-ink">
        <span className="grid size-8 place-items-center rounded-lg bg-accent-deep text-paper">
          <Icon name="chart" />
        </span>
        Lab Trends
      </div>
      {gate.code === 'access_off' ? (
        <AccessOff />
      ) : gate.code === 'access_mismatch' ? (
        <Mismatch team={gate.team} />
      ) : gate.code === 'forbidden' ? (
        <Forbidden email={gate.email} />
      ) : gate.code === 'not_ready' ? (
        <NotReady />
      ) : gate.code === 'misconfigured' ? (
        <Misconfigured />
      ) : (
        <Unverified />
      )}
    </div>
  )
}

function Screen({ title, lead, children }: { title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div>
        <h1 className="m-0 font-display text-[26px] leading-[1.15] font-medium tracking-[-0.02em] text-ink sm:text-[30px]">{title}</h1>
        <p className="m-0 mt-2 text-[14px] text-ink-dim">{lead}</p>
      </div>
      {children}
    </>
  )
}

const Reload = ({ children = 'Reload' }: { children?: ReactNode }) => (
  <Button variant="primary" onClick={() => window.location.reload()}>
    {children}
  </Button>
)

function AccessOff() {
  const steps: ReactNode[] = [
    <>
      In the Cloudflare dashboard, open <b>Workers &amp; Pages</b> and select this app’s Worker. It is named <code>lab-trends</code> unless you renamed it.
    </>,
    <>
      Open its <b>Access</b> tab and choose <b>Protect this Worker behind Access</b>. If Cloudflare asks you to set up Zero Trust first, pick any team name and the Free plan. It asks for a payment method and does not charge for this.
    </>,
    <>
      Choose <b>All traffic</b>. For who can sign in, choose <b>Cloudflare account</b>, which means the members of your Cloudflare account: only you, unless you have invited others. Then choose <b>Apply Access</b>.
    </>,
    <>Reload this page and sign in. The first person to sign in becomes this app’s owner, so do it before you share the address.</>,
  ]
  return (
    <Screen title="Turn on sign-in" lead="This app holds health records, so it stays locked until Cloudflare Access is guarding it. Nothing can be viewed or imported until then.">
      <Card>
        <ol className="m-0 grid list-none gap-4 p-0">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-[13.5px] text-ink">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-tint text-[12px] font-semibold text-accent-deep">{i + 1}</span>
              <span className="min-w-0 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <ButtonAnchor href={WORKERS_DASHBOARD} icon="external">
          Open Workers &amp; Pages
        </ButtonAnchor>
        <Reload>I’ve done this, reload</Reload>
      </div>
      <p className="m-0 text-[12.5px] text-ink-faint">
        Cloudflare’s own instructions:{' '}
        <a className={linkClass} href={ACCESS_GUIDE} target="_blank" rel="noreferrer">
          Cloudflare Access for Workers
        </a>
        .
      </p>
    </Screen>
  )
}

function Mismatch({ team }: { team?: string }) {
  return (
    <Screen
      title="Locked to a different sign-in"
      lead={
        <>
          This app only accepts sign-ins from the Cloudflare Access application it was first set up with{team ? <> (team <code>{team}</code>)</> : null}. This request came through a different one.
        </>
      }
    >
      <Card className="grid gap-3 text-[13.5px]">
        <p className="m-0">
          That happens after the Access application is deleted and recreated, or the app moves to another Cloudflare account. It also happens if someone else reached a brand-new app before you signed in. Either way, clear the lock, then reload and sign in:
        </p>
        <p className="m-0 text-ink-dim">
          In the dashboard, open{' '}
          <a className={linkClass} href={D1_DASHBOARD} target="_blank" rel="noreferrer">
            D1
          </a>
          , select this app’s database, open its console and run:
        </p>
        <CopyRow value="DELETE FROM instance;" mono />
        <p className="m-0 text-ink-dim">Or from a checkout of the code:</p>
        <CopyRow value={'npx wrangler d1 execute DB --remote --command "DELETE FROM instance"'} mono />
        <p className="m-0 text-ink-dim">
          Results and the people you added stay as they are. The next person to sign in becomes the owner. If you set <code>ACCESS_TEAM_DOMAIN</code> and <code>ACCESS_AUD</code> yourself, correct those instead.
        </p>
      </Card>
      <div>
        <Reload />
      </div>
    </Screen>
  )
}

function Forbidden({ email }: { email?: string }) {
  return (
    <Screen
      title="You’re not on the list"
      lead={
        <>
          You’re signed in{email ? <> as <b className="text-ink">{email}</b></> : null}, and that address has not been given access to this app. Ask the owner to add it under Settings, People with access.
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <ButtonAnchor href="/cdn-cgi/access/logout" target="_self">
          Sign in with another address
        </ButtonAnchor>
        <Reload />
      </div>
    </Screen>
  )
}

function NotReady() {
  return (
    <Screen title="Almost there" lead="The app is deployed, but its database tables have not been created yet. Deploying again creates them.">
      <Card className="grid gap-2 text-[13.5px]">
        <p className="m-0 text-ink-dim">From a checkout of the code:</p>
        <CopyRow value="npm run db:migrate:remote" mono />
      </Card>
      <div>
        <Reload />
      </div>
    </Screen>
  )
}

function Misconfigured() {
  return (
    <Screen
      title="Sign-in settings are incomplete"
      lead={
        <>
          This app has one of <code>ACCESS_TEAM_DOMAIN</code> and <code>ACCESS_AUD</code> set without the other, so it cannot tell which sign-in to trust. It stays locked until that is fixed.
        </>
      }
    >
      <Card className="grid gap-3 text-[13.5px]">
        <p className="m-0">
          In the Cloudflare dashboard, open <b>Workers &amp; Pages</b>, select this app’s Worker, then <b>Settings</b> and <b>Variables and Secrets</b>. Check both names for a typo, then do one of these:
        </p>
        <ul className="m-0 grid list-disc gap-1.5 pl-5 text-ink-dim">
          <li>Set both, to trust only that Cloudflare Access application.</li>
          <li>Delete both, to trust the application this app was first signed in through.</li>
        </ul>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <ButtonAnchor href={WORKERS_DASHBOARD} icon="external">
          Open Workers &amp; Pages
        </ButtonAnchor>
        <Reload />
      </div>
    </Screen>
  )
}

function Unverified() {
  return (
    <Screen title="Couldn’t check your sign-in" lead="Cloudflare’s sign-in service did not answer. Nothing is wrong with your results. Try again in a moment.">
      <div>
        <Reload />
      </div>
    </Screen>
  )
}
