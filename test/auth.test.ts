import { Hono } from 'hono'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { accessIdentity, sameOriginWrites } from '../src/worker/auth'
import { logMessage, type AppEnv } from '../src/worker/lib'

const MINE = 'mine.cloudflareaccess.com'
const OTHER = 'other.cloudflareaccess.com'
/** Its key endpoint answers 200 without any keys. */
const BROKEN = 'broken.cloudflareaccess.com'
const AUD = 'aud-of-this-app'

type Signer = { jwk: JsonWebKey & { kid: string }; key: CryptoKey }
const signers: Record<string, Signer> = {}
let fetched: string[] = []

async function signer(kid: string): Promise<Signer> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  return { key: pair.privateKey, jwk: { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid } }
}

const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url')

async function token(team: string, claims: Record<string, unknown> = {}, signedBy = team): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const body = { iss: `https://${team}`, aud: [AUD], email: 'owner@example.com', exp: now + 600, ...claims }
  const signed = `${b64url(JSON.stringify({ alg: 'RS256', kid: signers[signedBy].jwk.kid }))}.${b64url(JSON.stringify(body))}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signers[signedBy].key, new TextEncoder().encode(signed))
  return `${signed}.${b64url(new Uint8Array(signature))}`
}

type Row = { access_team_domain: string; access_aud: string; owner_email: string; claimed_at: string }

/** Just enough D1 for the three statements auth.ts runs. `raced`: the first read misses a row that another request is about to win. */
function database(seed: { instance?: Row; people?: string[]; broken?: boolean; raced?: boolean } = {}) {
  const state = { instance: seed.instance ?? null, people: (seed.people ?? []).map((email) => ({ email, added_at: '2026-01-01', added_by: null })) }
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    bind: (...next: unknown[]) => statement(sql, next),
    async run() {
      if (sql.startsWith('INSERT OR IGNORE INTO instance') && !state.instance) {
        state.instance = { access_team_domain: String(args[0]), access_aud: String(args[1]), owner_email: String(args[2]), claimed_at: String(args[3]) }
      }
      return {}
    },
    async first() {
      return state.instance
    },
  })
  return {
    state,
    prepare: (sql: string) => statement(sql),
    async batch(statements: { sql: string }[]) {
      if (seed.broken) throw new Error('no such table: instance')
      return statements.map((s) => ({ results: s.sql.includes('FROM instance') ? (state.instance && !seed.raced ? [state.instance] : []) : state.people }))
    },
  }
}

const env = (db: ReturnType<typeof database>, vars: Record<string, string> = {}) => ({ DB: db, ...vars }) as unknown as Env
const request = (jwt?: string, url = 'https://labs.example.com/api/me') => new Request(url, { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} })
const claimed: Row = { access_team_domain: MINE, access_aud: AUD, owner_email: 'owner@example.com', claimed_at: '2026-01-01' }

beforeAll(async () => {
  signers[MINE] = await signer('mine-key')
  signers[OTHER] = await signer('other-key')
  vi.stubGlobal('fetch', async (input: string) => {
    fetched.push(input)
    const team = new URL(input).hostname
    if (team === BROKEN) return Response.json({})
    return signers[team] ? Response.json({ keys: [signers[team].jwk] }) : new Response('not found', { status: 404 })
  })
})

afterEach(() => {
  fetched = []
})

describe('first sign-in', () => {
  it('refuses a request that did not come through Access', async () => {
    const db = database()
    expect(await accessIdentity(request(), env(db))).toMatchObject({ ok: false, status: 401, code: 'access_off' })
    expect(db.state.instance).toBeNull()
  })

  it('records the Access application and makes the first person the owner', async () => {
    const db = database()
    expect(await accessIdentity(request(await token(MINE, { email: 'Owner@Example.com' })), env(db))).toEqual({ ok: true, email: 'owner@example.com', owner: true })
    expect(db.state.instance).toMatchObject({ access_team_domain: MINE, access_aud: AUD, owner_email: 'owner@example.com' })
  })

  it('only fetches signing keys from a Cloudflare Access team domain', async () => {
    const db = database()
    for (const iss of ['https://evil.example.com', 'https://cloudflareaccess.com.evil.example', 'https://mine.cloudflareaccess.com/x', 'http://mine.cloudflareaccess.com']) {
      expect(await accessIdentity(request(await token(MINE, { iss })), env(db))).toMatchObject({ ok: false, status: 401 })
    }
    expect(fetched).toEqual([])
    expect(db.state.instance).toBeNull()
  })

  it('does not claim on a forged, expired or anonymous token', async () => {
    const db = database()
    const forged = await token(MINE, {}, OTHER)
    const expired = await token(MINE, { exp: Math.floor(Date.now() / 1000) - 3600 })
    const anonymous = await token(MINE, { email: undefined })
    const notYetValid = await token(MINE, { nbf: Math.floor(Date.now() / 1000) + 3600 })
    const oddEmail = await token(MINE, { email: 42 })
    for (const jwt of [forged, expired, anonymous, notYetValid, oddEmail, 'not.a.token', 'x']) {
      expect(await accessIdentity(request(jwt), env(db))).toMatchObject({ ok: false, status: 401, code: 'unauthenticated' })
    }
    expect(db.state.instance).toBeNull()
  })

  it('refuses a token that is not an RS256 token with an object of claims', async () => {
    const db = database()
    const [, payload, signature] = (await token(MINE)).split('.')
    const head = (alg: string) => b64url(JSON.stringify({ alg, kid: 'mine-key' }))
    const unsigned = `${head('none')}.${payload}.`
    const symmetric = `${head('HS256')}.${payload}.${signature}`
    const shapes = ['null', '[]', '"text"', '7'].map((claims) => `${head('RS256')}.${b64url(claims)}.${signature}`)
    for (const jwt of [unsigned, symmetric, ...shapes]) {
      expect(await accessIdentity(request(jwt), env(db))).toMatchObject({ ok: false, status: 401, code: 'unauthenticated' })
    }
    expect(db.state.instance).toBeNull()
  })

  it('checks whoever lost a race for the first sign-in against the winner', async () => {
    const won = () => database({ instance: claimed, raced: true })
    expect(await accessIdentity(request(await token(MINE)), env(won()))).toEqual({ ok: true, email: 'owner@example.com', owner: true })
    expect(await accessIdentity(request(await token(MINE, { email: 'second@example.com' })), env(won()))).toMatchObject({ ok: false, status: 403, code: 'forbidden' })
    expect(await accessIdentity(request(await token(OTHER)), env(won()))).toMatchObject({ ok: false, status: 401, code: 'access_mismatch', team: MINE })
  })

  it('lets only OWNER_EMAIL claim when it is set', async () => {
    const db = database()
    const vars = { OWNER_EMAIL: 'Owner@example.com' }
    expect(await accessIdentity(request(await token(MINE, { email: 'someone@example.com' })), env(db, vars))).toMatchObject({ ok: false, status: 403, code: 'forbidden' })
    expect(db.state.instance).toBeNull()
    expect(await accessIdentity(request(await token(MINE)), env(db, vars))).toMatchObject({ ok: true, owner: true })
    expect(db.state.instance).toMatchObject({ access_team_domain: MINE })
  })
})

describe('after the first sign-in', () => {
  it('refuses any other Access application without fetching its keys', async () => {
    const db = database({ instance: claimed })
    expect(await accessIdentity(request(await token(OTHER)), env(db))).toMatchObject({ ok: false, status: 401, code: 'access_mismatch', team: MINE })
    expect(await accessIdentity(request(await token(MINE, { aud: ['another-app'] })), env(db))).toMatchObject({ ok: false, code: 'access_mismatch' })
    expect(fetched).toEqual([])
    expect(db.state.instance).toEqual(claimed)
  })

  it('lets in the owner and the people they added, and nobody else', async () => {
    const db = database({ instance: claimed, people: ['family@example.com'] })
    expect(await accessIdentity(request(await token(MINE)), env(db))).toEqual({ ok: true, email: 'owner@example.com', owner: true })
    expect(await accessIdentity(request(await token(MINE, { email: 'family@example.com' })), env(db))).toEqual({ ok: true, email: 'family@example.com', owner: false })
    expect(await accessIdentity(request(await token(MINE, { email: 'stranger@example.com' })), env(db))).toMatchObject({ ok: false, status: 403, code: 'forbidden', email: 'stranger@example.com' })
  })

  it('treats OWNER_EMAIL as the owner over the recorded one', async () => {
    const db = database({ instance: claimed })
    const vars = { OWNER_EMAIL: 'new-owner@example.com' }
    expect(await accessIdentity(request(await token(MINE, { email: 'new-owner@example.com' })), env(db, vars))).toMatchObject({ ok: true, owner: true })
    expect(await accessIdentity(request(await token(MINE)), env(db, vars))).toMatchObject({ ok: false, status: 403 })
  })
})

describe('explicit settings', () => {
  const vars = { ACCESS_TEAM_DOMAIN: 'mine', ACCESS_AUD: AUD }

  it('trusts only the configured application, even before anyone has signed in', async () => {
    const db = database()
    expect(await accessIdentity(request(await token(OTHER)), env(db, vars))).toMatchObject({ ok: false, code: 'access_mismatch', team: MINE })
    expect(db.state.instance).toBeNull()
    expect(await accessIdentity(request(await token(MINE)), env(db, vars))).toMatchObject({ ok: true, owner: true })
  })

  it('wins over what the first sign-in recorded', async () => {
    const db = database({ instance: { ...claimed, access_team_domain: OTHER } })
    expect(await accessIdentity(request(await token(MINE)), env(db, vars))).toMatchObject({ ok: true, owner: true })
    expect(await accessIdentity(request(await token(OTHER)), env(db, vars))).toMatchObject({ ok: false, code: 'access_mismatch' })
  })

  it('refuses every sign-in when only one of the two is set', async () => {
    for (const half of [{ ACCESS_AUD: AUD }, { ACCESS_TEAM_DOMAIN: 'mine' }, { ACCESS_TEAM_DOMAIN: 'mine', ACCESS_AUD: ' ' }]) {
      for (const db of [database(), database({ instance: claimed })]) {
        expect(await accessIdentity(request(await token(MINE)), env(db, half))).toMatchObject({ ok: false, status: 503, code: 'misconfigured' })
      }
    }
    expect(fetched).toEqual([])
  })
})

describe('signing keys', () => {
  it('refuses, and caches nothing, when the key endpoint answers without keys', async () => {
    const db = database()
    const jwt = await token(BROKEN, {}, MINE)
    expect(await accessIdentity(request(jwt), env(db))).toMatchObject({ ok: false, status: 503, code: 'unverified' })
    expect(await accessIdentity(request(jwt), env(db))).toMatchObject({ ok: false, status: 503, code: 'unverified' })
    expect(fetched).toHaveLength(2)
    expect(db.state.instance).toBeNull()
  })

  it('refetches for an unknown key at most once a minute', async () => {
    const db = database({ instance: claimed })
    const unknownKey = await token(MINE, {}, OTHER)
    await accessIdentity(request(await token(MINE)), env(db))
    fetched = []
    for (let i = 0; i < 3; i++) expect(await accessIdentity(request(unknownKey), env(db))).toMatchObject({ ok: false, code: 'unauthenticated' })
    expect(fetched).toEqual([])

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61_000 })
    try {
      for (let i = 0; i < 3; i++) await accessIdentity(request(unknownKey), env(db))
      expect(fetched).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('writes from another site', () => {
  const app = new Hono<AppEnv>().use('*', sameOriginWrites).all('/api/people', (c) => c.json({ ok: true }))
  const send = (method: string, headers: Record<string, string> = {}) => app.request('https://labs.example.com/api/people', { method, headers })

  it('are refused when the browser says the request is not from this app', async () => {
    for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'none' }, { Origin: 'https://evil.example' }, { Origin: 'null' }]) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await send(method, { 'Content-Type': 'text/plain', ...headers })
        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ code: 'cross_site' })
      }
    }
  })

  it('are allowed from the app itself and from clients that are not browsers', async () => {
    for (const headers of [{ 'Sec-Fetch-Site': 'same-origin', Origin: 'https://labs.example.com' }, { Origin: 'https://labs.example.com' }, {}]) {
      expect((await send('POST', headers)).status).toBe(200)
    }
  })

  it('leave reads alone', async () => {
    expect((await send('GET', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(200)
  })
})

describe('edges', () => {
  it('uses DEV_AUTH_EMAIL on localhost only', async () => {
    const vars = { DEV_AUTH_EMAIL: 'dev@example.com' }
    expect(await accessIdentity(request(undefined, 'http://localhost:5173/api/me'), env(database(), vars))).toEqual({ ok: true, email: 'dev@example.com', owner: true })
    expect(await accessIdentity(request(), env(database(), vars))).toMatchObject({ ok: false, code: 'access_off' })
  })

  it('says so when the database has not been migrated', async () => {
    expect(await accessIdentity(request(await token(MINE)), env(database({ broken: true })))).toMatchObject({ ok: false, status: 503, code: 'not_ready' })
  })

  it('keeps parser-quoted content out of logs', () => {
    let error: unknown
    try {
      JSON.parse('{"raw_value": "4.1 mg/L" oops')
    } catch (err) {
      error = err
    }
    expect(logMessage(error)).toBe('SyntaxError: invalid JSON')
    expect(logMessage(new Error('3040: Capacity temporarily exceeded'))).toBe('3040: Capacity temporarily exceeded')
  })
})
