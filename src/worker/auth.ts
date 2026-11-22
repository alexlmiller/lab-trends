// Sign-in is Cloudflare Access. Access runs at Cloudflare's edge in front of this
// Worker and adds a signed token (Cf-Access-Jwt-Assertion) to every request it lets
// through. The Worker verifies that token itself, so a request that reaches it any
// other way fails closed.
//
// Which Access application is trusted:
//  - ACCESS_TEAM_DOMAIN + ACCESS_AUD, when both are set; otherwise
//  - the application that signed the first sign-in, recorded in the `instance` table.
// The first person to sign in becomes the owner (only OWNER_EMAIL may, when it is set).
// The owner and the people they add (allowed_users) may use the app. Anyone else gets
// 403, even if the Access policy let them through.
//
// DEMO_MODE=read-only is for a public demo of fictional records: no Access, anyone may
// read, nobody may change anything. It refuses to serve a database that holds anyone
// other than the demo people (subject ids starting "demo"), so switching it on for a
// real deployment by mistake exposes nothing.
import type { MiddlewareHandler } from 'hono'
import { nowIso, settings, type AppEnv } from './lib'

export type AuthCode = 'access_off' | 'access_mismatch' | 'unauthenticated' | 'forbidden' | 'unverified' | 'not_ready' | 'misconfigured' | 'demo_read_only' | 'demo_unsafe'

type Denied = { ok: false; status: 401 | 403 | 503; error: string; code: AuthCode; team?: string; email?: string }
export type Identity = { ok: true; email: string; owner: boolean } | Denied

type Jwk = JsonWebKey & { kid: string }
let jwksCache: { keys: Jwk[]; fetchedAt: number; team: string } | null = null

/** `refresh` is for a token naming a key that is not cached (keys rotate); it refetches at most once a minute. */
async function getKeys(team: string, refresh = false): Promise<Jwk[]> {
  if (jwksCache && jwksCache.team === team && Date.now() - jwksCache.fetchedAt < (refresh ? 60_000 : 3_600_000)) return jwksCache.keys
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`)
  const body = (await res.json()) as { keys?: unknown } | null
  if (!Array.isArray(body?.keys)) throw new Error('Access certs response has no keys')
  jwksCache = { keys: body.keys as Jwk[], fetchedAt: Date.now(), team }
  return jwksCache.keys
}

function b64urlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

type Claims = { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string }
type Token = { kid: string; claims: Claims; signed: string; signature: Uint8Array }

/** Parse without trusting anything: the claims only pick which keys to verify against. */
function readToken(token: string): Token | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0]))) as { kid?: string; alg?: string }
    if (header.alg !== 'RS256' || !header.kid) return null
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as Claims | null
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null
    return { kid: header.kid, claims, signed: `${parts[0]}.${parts[1]}`, signature: b64urlDecode(parts[2]) }
  } catch {
    return null
  }
}

/** The email in a token signed by `team` and currently valid, or null. Throws when the keys can't be fetched. */
async function verifiedEmail(token: Token, team: string): Promise<string | null> {
  let jwk = (await getKeys(team)).find((k) => k.kid === token.kid)
  if (!jwk) jwk = (await getKeys(team, true)).find((k) => k.kid === token.kid)
  if (!jwk) return null
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, token.signature, new TextEncoder().encode(token.signed))
  if (!ok) return null
  const now = Math.floor(Date.now() / 1000)
  if (typeof token.claims.exp !== 'number' || token.claims.exp < now - 30) return null
  if (token.claims.nbf && token.claims.nbf > now + 30) return null
  return typeof token.claims.email === 'string' ? token.claims.email.trim().toLowerCase() || null : null
}

/** Access issues tokens as https://<team>.cloudflareaccess.com. */
const ACCESS_TEAM = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/

function issuerHost(iss: unknown): string | null {
  if (typeof iss !== 'string' || !iss.startsWith('https://')) return null
  const host = iss.slice('https://'.length).toLowerCase()
  return /^[a-z0-9.-]+$/.test(host) ? host : null
}

/** Accepts "team", "team.cloudflareaccess.com" or the https URL. */
function teamHost(value: string): string {
  const host = value.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '')
  return host.includes('.') ? host : `${host}.cloudflareaccess.com`
}

export type InstanceRow = { access_team_domain: string; access_aud: string; owner_email: string; claimed_at: string }
type Person = { email: string; added_at: string; added_by: string | null }

/**
 * Who is trusted is read on every request, so an isolate keeps what it read
 * for a few seconds. A person removed from the list can therefore still be let
 * in for that long by an isolate that has not looked again; the isolate that
 * made the change forgets its copy at once. An unclaimed deployment is never
 * remembered, so the first sign-in always sees the database as it is.
 */
const TRUST_TTL_MS = 15_000
let trust: { row: InstanceRow; people: Person[]; expires: number } | null = null

export function forgetTrust() {
  trust = null
}

/** What this deployment trusts right now: settings win over what the first sign-in recorded. */
export async function instanceState(env: Env) {
  const s = settings(env)
  let row: InstanceRow | null
  let list: Person[]
  if (trust && trust.expires > Date.now()) ({ row, people: list } = trust)
  else {
    const [instance, people] = await env.DB.batch([
      env.DB.prepare('SELECT access_team_domain, access_aud, owner_email, claimed_at FROM instance WHERE id = 1'),
      env.DB.prepare('SELECT email, added_at, added_by FROM allowed_users ORDER BY added_at'),
    ])
    row = (instance.results[0] as InstanceRow | undefined) ?? null
    list = people.results as Person[]
    trust = row ? { row, people: list, expires: Date.now() + TRUST_TTL_MS } : null
  }
  const team = s.ACCESS_TEAM_DOMAIN?.trim()
  const aud = s.ACCESS_AUD?.trim()
  const configured = team && aud ? { team: teamHost(team), aud } : null
  return {
    row,
    configured,
    /** One of ACCESS_TEAM_DOMAIN / ACCESS_AUD without the other: refuse rather than guess what was meant. */
    halfConfigured: Boolean(team) !== Boolean(aud),
    trusted: configured ?? (row ? { team: row.access_team_domain, aud: row.access_aud } : null),
    ownerSetting: s.OWNER_EMAIL?.trim().toLowerCase() || null,
    people: list,
  }
}

function deny(status: Denied['status'], code: AuthCode, error: string, extra: { team?: string; email?: string } = {}): Denied {
  return { ok: false, status, code, error, ...extra }
}

export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/** Only this exact value turns demo mode on; anything else leaves normal sign-in in place. */
export function isDemo(env: Env): boolean {
  return settings(env).DEMO_MODE === 'read-only'
}

export const DEMO_EMAIL = 'demo@example.invalid'
export const DEMO_READ_ONLY = 'This is a read-only demo with sample records, so changes are turned off. Deploy your own copy to keep your results.'

/** Anyone may read a demo; nobody may change it. */
async function demoIdentity(request: Request, env: Env): Promise<Identity> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return deny(403, 'demo_read_only', DEMO_READ_ONLY)
  let others: { n: number } | null
  try {
    others = await env.DB.prepare("SELECT COUNT(*) AS n FROM subjects WHERE id NOT LIKE 'demo%'").first<{ n: number }>()
  } catch {
    return deny(503, 'not_ready', 'The database is not set up yet.')
  }
  if (!others || others.n > 0) return deny(503, 'demo_unsafe', 'Demo mode only serves sample records, and this database holds other people.')
  return { ok: true, email: DEMO_EMAIL, owner: false }
}

/** The signed-in user for a request that came through Access (a browser session or Access managed OAuth). */
export async function accessIdentity(request: Request, env: Env): Promise<Identity> {
  const devEmail = settings(env).DEV_AUTH_EMAIL
  if (devEmail && isLocalHost(new URL(request.url).hostname)) return { ok: true, email: devEmail.trim().toLowerCase(), owner: true }
  if (isDemo(env)) return demoIdentity(request, env)

  // Access always adds this header, so a request without it did not come through Access.
  const raw = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!raw) return deny(401, 'access_off', 'Sign-in is not turned on for this app.')
  const token = readToken(raw)
  const issuer = token && issuerHost(token.claims.iss)
  if (!token || !issuer) return deny(401, 'unauthenticated', 'Unauthenticated')
  const audiences = (Array.isArray(token.claims.aud) ? token.claims.aud : [token.claims.aud]).filter((a): a is string => typeof a === 'string' && a.length > 0)

  let state: Awaited<ReturnType<typeof instanceState>>
  try {
    state = await instanceState(env)
  } catch {
    return deny(503, 'not_ready', 'The database is not set up yet.')
  }
  if (state.halfConfigured) return deny(503, 'misconfigured', 'Set both ACCESS_TEAM_DOMAIN and ACCESS_AUD, or neither.')
  const { trusted } = state
  if (trusted) {
    if (issuer !== trusted.team || !audiences.includes(trusted.aud)) {
      return deny(401, 'access_mismatch', 'This app is locked to a different Cloudflare Access application.', { team: trusted.team })
    }
  } else if (!ACCESS_TEAM.test(issuer)) {
    return deny(401, 'unauthenticated', 'Unauthenticated')
  }

  let email: string | null
  try {
    email = await verifiedEmail(token, issuer)
  } catch {
    return deny(503, 'unverified', 'Could not check your sign-in with Cloudflare.')
  }
  if (!email) return deny(401, 'unauthenticated', 'Unauthenticated')

  let owner = state.ownerSetting ?? state.row?.owner_email ?? null
  if (!state.row && (!trusted || !owner)) {
    // First sign-in: record the Access application and the owner. One row, so two
    // racing first requests cannot both win; whoever lost is checked against the winner.
    if (state.ownerSetting && email !== state.ownerSetting) return deny(403, 'forbidden', `${email} is not on this app's list of people.`, { email })
    const aud = trusted?.aud ?? audiences[0]
    if (!aud) return deny(401, 'unauthenticated', 'Unauthenticated')
    await env.DB.prepare('INSERT OR IGNORE INTO instance (id, access_team_domain, access_aud, owner_email, claimed_at) VALUES (1, ?, ?, ?, ?)')
      .bind(issuer, aud, email, nowIso())
      .run()
    const row = await env.DB.prepare('SELECT access_team_domain, access_aud, owner_email FROM instance WHERE id = 1').first<InstanceRow>()
    if (!row) return deny(503, 'unverified', 'Could not record the first sign-in.')
    if (!trusted && (row.access_team_domain !== issuer || row.access_aud !== aud)) {
      return deny(401, 'access_mismatch', 'This app is locked to a different Cloudflare Access application.', { team: row.access_team_domain })
    }
    owner = state.ownerSetting ?? row.owner_email
  }

  if (email === owner) return { ok: true, email, owner: true }
  if (state.people.some((p) => p.email === email)) return { ok: true, email, owner: false }
  return deny(403, 'forbidden', `${email} is not on this app's list of people.`, { email })
}

export function denial(who: Denied): Response {
  return Response.json({ error: who.error, code: who.code, team: who.team, email: who.email }, { status: who.status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Identity for in-process API calls made by MCP tools on behalf of a user that
 * accessIdentity() verified earlier in the same request. A Symbol key on a derived
 * env object: nothing arriving over the network can set it.
 */
const INTERNAL_IDENTITY = Symbol('internal-identity')

export function withIdentity(env: Env, who: { email: string; owner: boolean }): Env {
  return Object.assign(Object.create(env) as Env, { [INTERNAL_IDENTITY]: { email: who.email, owner: who.owner } })
}

/**
 * A browser sends the Access session along with requests that other sites make, so a
 * page elsewhere could submit a form here as the signed-in person. Refuse any write
 * the browser says did not come from this app's own pages. Clients that are not
 * browsers send neither header and have no session to borrow.
 */
export const sameOriginWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()
  const site = c.req.header('Sec-Fetch-Site')
  const origin = c.req.header('Origin')
  const elsewhere = site ? site !== 'same-origin' : origin !== undefined && origin !== new URL(c.req.url).origin
  if (elsewhere) return c.json({ error: 'This request came from another site.', code: 'cross_site' }, 403, { 'Cache-Control': 'no-store' })
  return next()
}

export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const internal = (c.env as unknown as Record<symbol, unknown>)[INTERNAL_IDENTITY] as { email: string; owner: boolean } | undefined
  if (internal) {
    c.set('email', internal.email)
    c.set('owner', internal.owner)
    c.set('actor', `${internal.email} (via MCP)`)
    return next()
  }
  const who = await accessIdentity(c.req.raw, c.env)
  if (!who.ok) return denial(who)
  c.set('email', who.email)
  c.set('owner', who.owner)
  c.set('actor', who.email)
  return next()
}
